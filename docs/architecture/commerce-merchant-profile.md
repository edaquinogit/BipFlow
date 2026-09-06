# COMMERCE P1 — Merchant Profile

Primeira etapa da frente **COMMERCE** (checkout, pagamentos, documentos
fiscais). Permite que cada `Store` cadastre sua identidade comercial,
contato, endereço e links de redes sociais. É a fundação de dados que
`COMMERCE P3` (onboarding no provedor de pagamento) e `COMMERCE P4`
(`StoreFiscalProfile`) vão reusar.

**Fora de escopo aqui:** pagamento, PIX, cartão, webhook, `Payment`,
`StorePaymentIntegration`, nota fiscal, `StoreFiscalProfile`,
`FiscalDocument`, checkout do cliente, alteração do fluxo WhatsApp, frete
automático, cupons, autocomplete de CEP.

## Modelo de domínio

Novo model **`MerchantProfile`** (`OneToOneField(Store)`), no mesmo padrão de
`LabelSettings` / `StorefrontAppearance`: um cluster de configuração por
loja, com `MerchantProfile.get_for_store(store)` criando a linha vazia na
primeira leitura. **Não** são colunas novas em `Store` — `Store` continua
carregando só o que o motor de tema da vitrine precisa.

| Campo | Armazenamento | Público? | Obrigatório? |
| --- | --- | --- | --- |
| `legal_name` | texto (Razão social) | não | não |
| `trade_name` | texto (Nome fantasia) | **sim** | não |
| `tax_id` | **só dígitos** — CPF (11) ou CNPJ (14); checksum mod-11 validado | não | não |
| `contact_email` | `EmailField` | não | não |
| `contact_phone` | **só dígitos** (DDI+DDD+número, 10–13) | não | não |
| `postal_code` | **só dígitos** (CEP, 8) | não | não |
| `street` / `number` / `complement` / `district` | texto | não | não |
| `city` | texto | **sim** | não |
| `state` | UF (lista fechada das 27) | **sim** | não |
| `country` | 2 letras, default `BR` | não | não |
| `website_url` | `URLField`, só `http`/`https` | **sim** | não |
| `instagram_url` / `facebook_url` / `tiktok_url` / `youtube_url` | `URLField`, só `http`/`https` + host coerente com a rede | **sim** | não |

`is_complete` e `has_complete_address` são **propriedades computadas**
(nunca persistidas, nunca um gate rígido) expostas como campos read-only no
serializer — dica de onboarding para o dashboard.

### Nenhum campo obrigatório

Todo campo é `blank=True`. Uma `Store` criada antes deste model continua
funcionando com um perfil todo vazio; a migration (`0047_merchantprofile`)
só cria a tabela nova, sem data migration, sem backfill.

### WhatsApp fica de fora

O handoff do checkout lê `Store.whatsapp_phone` via
`Store.get_configured_whatsapp_phone()` — essa continua a única fonte da
verdade, editada na aba **WhatsApp** de Configurações. Duplicar o número
aqui re-fragmentaria um campo que a evolução multi-tenant já consolidou.

### Nada fiscal aqui

`tax_id` é um campo cadastral simples. `tax_regime`, `inscricao_estadual`,
`inscricao_municipal`, `fiscal_environment`, provedor, certificado — tudo
isso é `StoreFiscalProfile` (COMMERCE P4).

## API

Rota canônica única, no mesmo padrão de `/store/current/appearance/`:

```
GET   /api/v1/store/current/merchant-profile/
PATCH /api/v1/store/current/merchant-profile/
```

- Tenant resolvido por `resolve_request_store(request)` (claim JWT
  `store_id` / header `X-Store-Slug` confiável) — **nunca** um id vindo do
  corpo do request. `store`/`id` não são expostos no payload.
- `PATCH` é **parcial**: campo omitido preserva o valor atual; string vazia
  (`""`) é "limpar este campo" explícito. Não há `null` — limpar é via `""`.
- Entrada mascarada é aceita e normalizada: `"11.222.333/0001-81"` →
  `"11222333000181"`, `"40010-000"` → `"40010000"`, `"(71) 3333-4444"` →
  `"7133334444"`.

### RBAC

Mesmo gate das telas de aparência da vitrine
(`can_read_storefront_dashboard_store` / `can_edit_storefront_dashboard_store`):

| Ação | Quem |
| --- | --- |
| `GET` (ver) | qualquer `StoreMembership` na loja resolvida, ou staff |
| `PATCH` (editar) | `StoreMembership.role in (owner, manager)`, ou staff |

Sem papel novo — reusa `StoreMembership` como está.

## Projeção pública

O endpoint público que já existe
`GET /api/v1/public/stores/{slug}/appearance/` ganha um objeto `merchant`
com **apenas** `MerchantProfile.PUBLIC_FIELDS`:

```
merchant: { trade_name, city, state,
            website_url, instagram_url, facebook_url, tiktok_url, youtube_url }
```

Nunca `legal_name`, `tax_id`, `contact_email`, `contact_phone`, nem o
endereço em nível de rua (`street`/`number`/`complement`/`district`/
`postal_code`). Uma leitura pública **não** cria a linha (usa
`.filter().first()` + instância transiente para manter o shape estável).

## Vitrine

`StorefrontSocialLinks.vue` no rodapé de `ProductsView.vue` — uma linha
discreta de links (site + redes). Renderiza **nada** quando a loja não
preencheu nenhum link. Cada link abre em nova aba com
`rel="noopener noreferrer"` e só é renderizado se casar `^https?://`.

## Invariante multi-tenant

`MerchantProfile` pertence sempre a exatamente uma `Store`
(`OneToOneField`, `on_delete=CASCADE`). Nenhuma query confia em `pk` ou em
`store_id` do frontend — a loja vem sempre de `resolve_request_store`.
Acesso cross-tenant (claim `store_id` de outra loja) → `403`.

## Classificação de dados

| Dado | Classe | Regra |
| --- | --- | --- |
| `trade_name`, `city`, `state`, links | PUBLIC | eco na vitrine; links só `http(s)`, render como href, nunca HTML |
| `legal_name`, endereço completo, `contact_email`, `contact_phone` | INTERNAL | dashboard-only, atrás do gate de membership |
| `tax_id` | INTERNAL | dashboard-only; nunca na projeção pública; digits-only |

Nenhum SECRET é introduzido nesta etapa.
