# Evolução Multi-Loja (Multi-Tenant)

Este documento registra a estratégia usada para evoluir o Bip Flow de
**single-tenant** (uma loja por instância) para **multi-loja** (várias lojas
isoladas na mesma instância). Ele continua como histórico/roadmap técnico da
evolução; a visão operacional atual fica em
[system-overview.md](system-overview.md).

> Status atual em 2026-08-13: a base multi-loja por coluna `store_id` ja esta
> implementada para os fluxos principais. Existem `Store`, `StoreMembership`,
> `store_id` nas tabelas de negocio, resolucao por `X-Store-Slug`/JWT,
> seletor de loja no dashboard, rotas publicas `/l/:storeSlug/...` e fallback
> `default` para compatibilidade. `StoreSettings` permanece como contrato
> legado/minimo de WhatsApp, enquanto dados ricos vivem em `Store`.

## 1. Diagnóstico original

O diagnóstico abaixo descreve o estado anterior a evolução multi-loja. Ele fica
registrado para explicar as decisões e as fases executadas.

O sistema assumia um catálogo único e global. Pontos que impediam múltiplas
lojas:

| Camada | Situação atual | Bloqueio |
| --- | --- | --- |
| `StoreSettings` | Singleton (`singleton_key=1`, `unique`) | Apenas 1 configuração de loja (WhatsApp único) por banco |
| `Product` / `Category` / `DeliveryRegion` | Sem coluna de escopo | Catálogo, frete e regiões são compartilhados globalmente |
| `SaleOrder` / `SaleOrderItem` | Sem coluna de escopo | Histórico de vendas é consolidado, sem separar por loja |
| Usuários / RBAC | Papéis `admin`/`manager`/`viewer` globais (grupos Django) | Um admin enxerga tudo; não existe "dono da loja X" |
| Checkout | `StoreSettings.get_configured_whatsapp_phone()` resolve 1 número | Pedido sempre vai para o mesmo WhatsApp |
| Frontend | URL sem escopo (`/produtos`, `/`), carrinho global em `localStorage` | Não há como saber qual loja o visitante está vendo |
| JWT | Token sem `store_id` | Backend não consegue filtrar dados pela loja do usuário |

Arquivos-âncora: `bipdelivery/api/models.py`, `bipdelivery/api/views.py`,
`bipdelivery/api/permissions.py`, `bipflow-frontend/src/services/api.ts`,
`bipflow-frontend/src/router/index.ts`.

## 2. Decisão arquitetural

Três estratégias possíveis:

| Estratégia | Como funciona | Veredito |
| --- | --- | --- |
| **Tenant por coluna (`store_id`)** | Uma tabela `Store`; tabelas de negócio ganham FK `store_id`; queries filtram por loja | **Recomendado** — simples, 1 banco, barato de operar |
| Schema por tenant | Cada loja em um schema isolado (PostgreSQL) | Só para SaaS grande; SQLite não suporta |
| Banco por tenant | Um banco por loja | Inviável de escalar/operar |

**Decisão:** multi-tenancy **por coluna (`store_id`)**.

**Pré-requisito técnico:** migrar **SQLite → PostgreSQL**. O checkout usa
`select_for_update()`; com várias lojas escrevendo simultaneamente, o lock
global do SQLite vira gargalo.

## 3. Modelo de dados alvo

Introduzir a entidade raiz `Store` e o vínculo usuário↔loja:

```python
class Store(models.Model):
    name           = CharField(max_length=120)
    slug           = SlugField(unique=True)          # loja na URL pública
    whatsapp_phone = CharField(max_length=32)        # absorve StoreSettings
    is_active      = BooleanField(default=True)
    owner          = ForeignKey(User, on_delete=PROTECT, related_name="owned_stores")
    created_at     = DateTimeField(auto_now_add=True)

class StoreMembership(models.Model):                 # substitui o RBAC global
    store = ForeignKey(Store, on_delete=CASCADE, related_name="memberships")
    user  = ForeignKey(User, on_delete=CASCADE, related_name="store_memberships")
    role  = CharField(choices=[("owner","owner"),("manager","manager"),("viewer","viewer")])

    class Meta:
        unique_together = ("store", "user")
```

Adicionar `store = ForeignKey(Store)` em: `Category`, `Product`,
`DeliveryRegion`, `SaleOrder` (`ProductGalleryImage` e `SaleOrderItem` herdam o
escopo pela FK do pai).

### Constraints a revisar (hoje são `unique` globais e quebrariam o multi-loja)

| Campo atual | Novo escopo |
| --- | --- |
| `Category.name` / `Category.slug` (unique) | `unique_together=("store", "slug")` |
| `Product.sku` (unique) | `unique_together=("store", "sku")` |
| `Product.slug` | único por loja |
| `DeliveryRegion.name` (unique) | `unique_together=("store", "name")` |
| `StoreSettings` (singleton) | **descontinuado** — absorvido por `Store` |

## 4. Plano de evolução por etapas verticais

O plano original organizava o trabalho em **fases horizontais** (backend
completo, depois frontend completo). Para um projeto solo isso é arriscado:
semanas sem nada visível/testável de ponta a ponta, e uma integração grande de
uma vez quando o frontend finalmente entra — exatamente o tipo de mudança
grande e especulativa que este projeto evita.

Por isso a evolução foi organizada em **etapas verticais**: cada etapa entregou
backend **e** frontend juntos, na mesma janela de trabalho, mantendo o
comportamento da loja `default` durante a migração. Foi o padrão *strangler fig
/ dark launch*: a estrutura multi-tenant foi construída por baixo do sistema
existente antes de expor rotas por loja e seletor de loja.

### Etapa 0 — Saneamento e rede de segurança ✅ (concluída)

- Consolidar o Django como backend canônico.
- Arquivar o motor Node legado em `legacy/node-engine/`.
- Atualizar README e `docs/architecture/system-overview.md` para a arquitetura real.
- Garantir testes do fluxo atual verdes antes de qualquer mudança estrutural
  (97+ testes pytest) e adicionar CI (`.github/workflows/ci.yml`) como rede de
  segurança durável.
- **Não** implementar `Store`, `StoreMembership` nem migrations multi-tenant
  ainda.

### Etapa 1 — Fundação de contrato

Backend:

- Criar `Store` e `StoreMembership`.
- **Data migration**: criar uma "loja default", apontar todos os registros
  existentes para ela e migrar `StoreSettings.whatsapp_phone` →
  `Store.whatsapp_phone`. Sem perda de dados.
- Adicionar endpoint `GET /api/v1/store/current/`, que por enquanto sempre
  resolve para a loja default.

Frontend:

- Composable `useCurrentStore()` consumindo o endpoint acima.
- Tipos TypeScript `Store` / `StoreMembership`.

**Visível para o usuário final:** não. **Risco:** baixo.

### Etapa 2 — `store_id` invisível

Backend:

- Adicionar `store_id` nas tabelas de negócio (`Category`, `Product`,
  `DeliveryRegion`, `SaleOrder`) como nullable → backfill para a loja default
  → not null.
- Trocar as constraints `unique` globais por `unique_together` com `store`.
- Criar índices por `store_id`.
- (Pré-requisito antes da Etapa 3) migrar dev/prod para PostgreSQL.

Frontend:

- Nenhuma mudança — o contrato de API não muda nesta etapa.

**Visível para o usuário final:** não. **Risco:** baixo (é schema + backfill,
sem mudar nenhuma query ainda).

### Etapa 3 — Isolamento ativo (ponto mais sensível)

Backend:

- Resolver a loja por request:
  - **Público/catálogo:** por `slug` na URL (ex.: `/api/v1/<store_slug>/...`)
    ou header `X-Store-Slug`.
  - **Dashboard/autenticado:** `store_id` como claim no JWT + `StoreMembership`.
- Criar um **queryset/mixin base** que aplica `.filter(store=request.store)`
  automaticamente em **todas** as viewsets — não depender de lembrar em cada
  endpoint (principal fonte de vazamento entre tenants).
- Reescrever `CheckoutWhatsAppView`: WhatsApp via `request.store.whatsapp_phone`
  (não mais o singleton) e validar que todos os `product_id` do carrinho
  pertencem à loja do checkout.
- Atualizar `permissions.py`: papéis passam a ser **por loja** (via
  `StoreMembership`), não mais globais.

Frontend:

- `api.ts` passa a enviar o escopo da loja (vem do JWT/contexto, de forma
  transparente para o usuário).
- Carrinho migra de `bipflow_public_cart_items` para `bipflow_cart_<storeSlug>`,
  com migração on-read do carrinho antigo na primeira visita.
- Rotas preparadas para `/l/:storeSlug/produtos`, mas com redirect automático
  para a loja default em `/produtos` — não forçar troca de URL para quem já
  tem link salvo.

**Visível para o usuário final:** não (1 loja = comportamento idêntico).
**Risco:** alto — é onde vazamento entre lojas pode acontecer. Teste de
isolamento ("usuário da loja A não acessa pedido da loja B") é obrigatório
antes de qualquer outra coisa nesta etapa.

### Etapa 4 — Multi-loja real

Backend:

- Fluxo de cadastro de loja (cria `Store` + `StoreMembership` owner no registro).
- Convite de membros para uma loja.
- Upload de imagens isolado por loja (`products/<store_id>/%Y/%m/`).
- Django admin filtrando por loja.

Frontend:

- Seletor de loja (store switcher) quando o usuário pertence a mais de uma.
- Tela de criação/configuração de loja (nome, slug, WhatsApp).

**Visível para o usuário final:** sim — aqui a feature aparece de fato.
**Risco:** médio.

## 5. Riscos e pontos de atenção

| Risco | Onde aparece | Mitigação |
| --- | --- | --- |
| Vazamento de dados entre lojas (risco nº 1) | Etapa 3 | Queryset base obrigatório (`.filter(store=request.store)` em toda viewset) + teste de isolamento ("usuário da loja A não acessa pedido da loja B") antes de qualquer outra coisa na etapa |
| Constraints `unique` globais quebram no backfill | Etapa 2 | Auditar SKUs/slugs duplicados antes de criar `unique_together` |
| SQLite + concorrência (lock global no checkout via `select_for_update()`) | Antes da Etapa 3 | Migrar para PostgreSQL antes de habilitar escrita concorrente real entre lojas |
| Token JWT antigo sem `store_id` | Etapa 3 | Tokens emitidos antes da etapa expiram naturalmente (refresh de 1 dia) — não precisa migração de sessão |
| Rota pública atual (`/produtos`) quebrar | Etapa 3 | Manter `/produtos` funcionando via redirect implícito para `/l/<default>/produtos` |
| Carrinho de cliente existente no localStorage | Etapa 3 | Migração on-read de `bipflow_public_cart_items` para `bipflow_cart_<default>` na primeira visita pós-deploy |
| Throttling de checkout (hoje por IP/telefone global) | Etapa 3/4 | Revisar se deve ser também por loja |
| Mídia/imagens compartilhadas | Etapa 4 | Isolar paths por `store_id`; considerar storage externo (S3) quando crescer |

## 6. Esforço estimado (ordem de grandeza)

| Etapa | Backend | Frontend | Total aprox. |
| --- | --- | --- | --- |
| 0 — Saneamento + CI | — | — | ✅ concluída |
| 1 — Fundação de contrato | 1–2 dias | 0.5–1 dia | 2–3 dias |
| 2 — `store_id` invisível | 2–3 dias | — | 2–3 dias |
| PostgreSQL (antes da Etapa 3) | 1–2 dias | — | 1–2 dias |
| 3 — Isolamento ativo | 4–6 dias | 2–3 dias | **6–9 dias** (a mais sensível) |
| 4 — Multi-loja real | 2–3 dias | 3–4 dias | 5–7 dias |

Total aproximado: 3–4 semanas de trabalho solo. Span de calendário maior se
intercalado com manutenção do produto atual — saudável para um projeto solo,
não é uma corrida.

## 7. Definição De Pronto Da Evolucao

- [x] Backend canônico = Django; motor Node arquivado em `legacy/`.
- [x] README e visão geral refletem a arquitetura real.
- [x] Este documento criado.
- [x] Testes do fluxo atual verdes (pytest) e CI configurado como rede de
      segurança.
- [x] `Store` / `StoreMembership` implementados.
- [x] `store_id` adicionado aos modelos de negocio principais.
- [x] Resolucao de loja centralizada em `store_scope.py`.
- [x] Rotas publicas com `storeSlug` e seletor de loja no dashboard.
- [x] Isolamento de catalogo, delivery, checkout, bot, estoque e vendas coberto
      por testes.
