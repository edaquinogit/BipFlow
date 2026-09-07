# Entrega Tecnica Para Avaliacao

Este documento resume o que foi entregue no Bip Flow para leitura de
tech lead, avaliador tecnico ou recrutador tecnico. Ele complementa o README
principal com foco em escopo, evidencias, comandos de validacao, decisoes e
limites conhecidos.

## Sumario Executivo

- **Produto:** plataforma full-stack para pequenos negocios que vendem por
  WhatsApp e precisam organizar catalogo, frete, carrinho, checkout e historico
  de vendas.
- **Stack principal:** Django REST, Vue 3, TypeScript, Vite, SQLite local,
  PostgreSQL e Redis no Docker Compose.
- **Fluxo critico:** cliente navega no catalogo publico, monta carrinho,
  escolhe entrega, envia pedido para WhatsApp e o backend persiste a venda.
- **Autoridade de negocio:** preco, estoque, disponibilidade, frete, total,
  permissao e pedido ficam sob responsabilidade do backend.
- **Objetivo da entrega:** demonstrar capacidade junior de construir, explicar,
  testar e documentar um produto web completo com limites claros.

## Escopo Entregue

- Dashboard administrativo protegido por JWT e papel de dashboard.
- Base multi-loja com `Store`, `StoreMembership`, seletor de loja e vitrine
  publica por `storeSlug`.
- CRUD de produtos e categorias com leitura publica e escrita administrativa.
- Upload de capa e galeria limitada a tres imagens por produto.
- Codigo publico imutavel por produto, QR de etiqueta e lookup por
  `/products/by-code/{code}/`.
- Movimentacoes de estoque auditadas para entrada, saida, venda e cancelamento.
- PDV de balcao por codigo/QR, recibo e envio de recibo por email.
- Regioes de entrega configuraveis e taxa usada no checkout publico.
- Configuracao de WhatsApp da loja pelo dashboard.
- Catalogo publico com busca, filtros, detalhe por slug, carrinho e checkout.
- Perfil autenticado de cliente por loja para reutilizar identidade e endereco.
- Checkout via WhatsApp com validacao server-side e persistencia de
  `SaleOrder` e `SaleOrderItem`.
- Historico de vendas para usuarios com papel de dashboard e atualizacao de
  status por operadores com permissao de escrita, incluindo envio e entrega.
- Bot publico deterministico, sem IA externa, integrado a produtos e regioes
  ativas.
- Vitrine administrativa read-only para conversas do bot.
- Runtime Docker Compose com frontend Nginx, backend Gunicorn, PostgreSQL e
  Redis.

## Mapa De Evidencias

| O que avaliar | Evidencia no repositorio |
| --- | --- |
| Dominio e persistencia | `bipdelivery/api/models.py` |
| Contratos e validacao da API | `bipdelivery/api/serializers.py` |
| Endpoints e permissoes | `bipdelivery/api/views.py`, `bipdelivery/api/permissions.py` |
| Rotas versionadas | `bipdelivery/api/v1_urls.py` |
| Bot deterministico | `bipdelivery/api/bot_engine.py` |
| Frontend publico | `bipflow-frontend/src/views/products/` |
| Dashboard | `bipflow-frontend/src/views/dashboard/` |
| Camada HTTP frontend | `bipflow-frontend/src/services/` |
| Estado reutilizavel | `bipflow-frontend/src/composables/` |
| Loja e escopo por tenant | `bipdelivery/api/store_scope.py`, `bipflow-frontend/src/composables/useCurrentStore.ts` |
| PDV, QR e estoque | `bipdelivery/api/pdv.py`, `bipdelivery/api/product_labels.py`, `bipdelivery/api/stock.py` |
| Testes backend | `bipdelivery/tests/` |
| Testes frontend | `bipflow-frontend/src/**/*.spec.ts` |
| E2E | `bipflow-frontend/cypress/e2e/` |
| Deploy local containerizado | `docker-compose.yml`, `Dockerfile`, `docker/` |
| Variaveis de ambiente | `.env.example` |

## Decisoes Tecnicas

- **Backend como fonte de verdade:** evita que cliente ou frontend definam
  preco, estoque, frete e total.
- **RBAC simples e verificavel:** `staff`, `superuser`, `admin`, `manager` e
  `viewer` cobrem leitura de dashboard e escrita administrativa.
- **Frontend por camadas:** views chamam composables e services; chamadas HTTP
  ficam centralizadas em `src/services/`.
- **Token store unico:** JWT fica concentrado em
  `bipflow-frontend/src/services/token-store.ts`.
- **Bot sem IA nesta fase:** escolha feita para manter previsibilidade, custo
  zero, testes simples e baixo acoplamento.
- **Node isolado:** o motor Node da raiz existe como componente independente e
  nao faz parte do runtime normal Django + Vue.
- **Documentacao versionada:** os documentos descrevem estado atual, nao
  roadmap aspiracional.

## Comandos De Validacao

Backend:

```powershell
python bipdelivery\manage.py check
python -m pytest bipdelivery/tests
ruff check bipdelivery/api bipdelivery/tests
```

Frontend:

```powershell
npm run frontend:typecheck
npm run frontend:lint
npm run frontend:test:unit
npm run frontend:build
```

Documentacao:

```powershell
npm run docs:check
```

Atalho padrao de teste na raiz:

```powershell
npm test
```

## Setup De Demonstracao

Fluxo completo com Docker:

```powershell
Copy-Item .env.example .env
docker compose up --build
```

URLs esperadas:

- Aplicacao: `http://localhost:8080/`
- API: `http://localhost:8080/api/`
- Admin Django: `http://localhost:8080/admin/`

Fluxo local sem Docker:

```powershell
.\bootstrap-env.ps1
cd bipdelivery
.\venv\Scripts\python.exe manage.py migrate
.\venv\Scripts\python.exe manage.py seed_dashboard_roles --email admin@example.com --password admin123 --staff --role admin
.\venv\Scripts\python.exe manage.py runserver
```

Em outro terminal:

```powershell
cd bipflow-frontend
npm install --ignore-scripts
Copy-Item .env.example .env.local
npm run dev
```

## Riscos E Limites Conhecidos

- O bot e um MVP deterministico; ele nao usa IA, nao fala com API oficial do
  WhatsApp e nao substitui atendimento humano.
- O checkout gera URL/mensagem de WhatsApp e persiste pedido, mas nao recebe
  callback externo de pagamento ou confirmacao de entrega.
- SQLite e usado no desenvolvimento local; o runtime containerizado usa
  PostgreSQL.
- Segredos reais nao entram no repositorio; `.env.example` e apenas template.
- O motor Node da raiz precisa ser avaliado separadamente se virar parte do
  produto principal.

## Checklist Para Review

- README explica problema, stack, setup, qualidade e materiais de demonstracao.
- Arquitetura separa claramente Django, Vue e motor Node isolado.
- Guia de desenvolvimento contem comandos locais e cuidados de manutencao.
- Referencia da API descreve endpoints, permissoes, payloads e respostas.
- Documentacao do bot registra escopo, contratos, regras e criterio de aceite.
- Comandos de qualidade estao documentados e expostos na raiz quando aplicavel.
- Limites conhecidos estao declarados sem prometer funcionalidade inexistente.

## Ordem Recomendada De Leitura

1. [README principal](../README.md)
2. [Arquitetura](architecture/system-overview.md)
3. [Referencia da API Django](api/reference.md)
4. [Guia de desenvolvimento](development-guide.md)
5. [Bot do catalogo](features/catalog-bot.md)
