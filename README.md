# Bip Flow

Plataforma SaaS full-stack multi-tenant para pequenos negócios que precisam
controlar catálogo, estoque, frete, pedidos, PDV, vitrine digital e checkout
via WhatsApp sem depender de planilhas ou mensagens soltas. O fluxo principal
usa backend Django REST, frontend Vue 3 + TypeScript e checkout público com
geração de pedido para WhatsApp.

## Multi-tenant

**Bip Flow** é a plataforma (o SaaS, o painel administrativo, o ecossistema
multi-loja). Cada loja é um _tenant_ independente que usa o Bip Flow como
infraestrutura: catálogo, estoque, pedidos, RBAC e vitrine própria, isolados
por `store_id`.

`Boutique Fitness`, por exemplo, é apenas uma loja cliente rodando sobre o
Bip Flow — não é o produto. O login administrativo (`/login`) e os metadados
globais apresentam **Bip Flow**; a vitrine de uma loja (`/l/<slug>/…`)
apresenta o nome e a identidade daquela loja. As duas identidades nunca se
misturam.

## Visão Rápida

- Dashboard administrativo com autenticação, papéis de acesso, troca de loja
  e rotas protegidas.
- Catálogo público com produtos, categorias, carrinho e detalhe por slug ou
  `public_code`.
- Frete por região, calculado e validado no backend.
- Checkout via WhatsApp com pedido persistido no histórico de vendas.
- PDV de balcão por QR/código público, recibo e baixa de estoque auditada.
- Backend como autoridade para preço, estoque, disponibilidade, frete e totais.
- Qualidade verificada com testes backend, typecheck, lint, testes frontend e
  build.

## Demonstração E Evidências

Este projeto também possui material de apresentação fora do repositório:

- **Vídeo completo no LinkedIn:** [demonstração explicada do fluxo do produto](https://www.linkedin.com/posts/ednaldo-aquino-backend_opentowork-vagasti-desenvolvedor-ugcPost-7455073194668888064-kCBE).
- **Carrossel técnico no LinkedIn:** [9 slides explicando arquitetura, stack e
  decisões de engenharia](https://www.linkedin.com/posts/ednaldo-aquino-backend_estagio-opentowork-desenvolvedor-ugcPost-7454498028276760578-zi7X).
- **Código-fonte:** este repositório mantém a implementação, documentação e
  comandos de validação.

Acesse os materiais pelo perfil:
[LinkedIn - Ednaldo Aquino](https://www.linkedin.com/in/ednaldo-aquino-backend/)

## Para Recrutadores

Este repositório também funciona como evidência prática do meu perfil em
desenvolvimento full-stack junior. Para leitura de carreira:

- [Entrega técnica para avaliação](docs/technical-delivery.md): resumo
  profissional para tech lead, avaliador técnico ou recrutador técnico, com
  escopo, decisões, evidências, comandos e limites conhecidos.
- [Currículo ATS em DOCX](docs/career/Ednaldo_Aquino_Curriculo_ATS.docx):
  versão adequada para envio em processos seletivos e leitura por sistemas ATS.
- [Currículo em Markdown](docs/career/Ednaldo_Aquino_Curriculo_ATS.md):
  versão aberta, revisável e alinhada ao projeto.

## Como Avaliar Em 3 Minutos

Use este roteiro para entender o projeto sem precisar abrir todos os arquivos:

- **0:00 - 0:30 | Valor entregue:** leia a [Visão Rápida](#visão-rápida) e
  [Por Que Este Projeto Existe](#por-que-este-projeto-existe) para entender o
  problema, o público e o fluxo de venda resolvido.
- **0:30 - 1:10 | Arquitetura real:** abra
  [docs/architecture/system-overview.md](docs/architecture/system-overview.md)
  para confirmar os limites entre Django REST, Vue 3 e o motor Node isolado.
- **1:10 - 1:30 | Entrega técnica:** leia
  [docs/technical-delivery.md](docs/technical-delivery.md) para ver escopo,
  evidências, comandos e riscos conhecidos em formato de avaliação.
- **1:30 - 2:10 | Fluxo crítico no código:** confira
  `bipdelivery/api/models.py`, `bipdelivery/api/serializers.py`,
  `bipdelivery/api/views.py`, `bipflow-frontend/src/services/order.service.ts`
  e `bipflow-frontend/src/views/products/`. Esses arquivos mostram catálogo,
  frete, carrinho, checkout via WhatsApp, pedido persistido e bot MVP.
- **2:10 - 2:40 | Qualidade verificável:** leia a seção
  [Qualidade](#qualidade) e os testes em `bipdelivery/tests/`, especialmente
  checkout, permissões, filtros de produto e bot guiado por regras.
- **2:40 - 3:00 | Evidência de comunicação:** assista à demonstração, veja o
  carrossel técnico e leia o [Estudo De Caso STAR](#estudo-de-caso-star) para
  avaliar clareza, tomada de decisão e capacidade de explicar trade-offs.

Sinais técnicos para observar durante a triagem:

- Backend como fonte de verdade para preço, estoque, frete, total e pedido.
- RBAC, JWT, throttling e leitura pública separados de escrita administrativa.
- Frontend organizado por services, composables, schemas, types e views.
- Checkout público persistindo `SaleOrder` para o dashboard administrativo.
- Bot MVP sem IA externa, testável e integrado ao catálogo e regiões ativas.
- Documentação curta, versionada e conectada ao código implementado.

## Por Que Este Projeto Existe

Pequenos negócios que vendem por WhatsApp normalmente precisam controlar
catálogo, disponibilidade, endereço, taxa de entrega, pedido e histórico em
ferramentas separadas. Isso aumenta retrabalho e risco de erro no valor final.

O BipFlow centraliza esse fluxo em uma aplicação operável: o cliente navega no
catálogo público, monta o carrinho, escolhe a entrega, envia o pedido para
WhatsApp e o backend registra a venda para consulta posterior no dashboard.

## Estudo De Caso STAR

**Situação:** vendas por WhatsApp dependem muito de processos manuais para
catálogo, frete, carrinho, pedido e histórico de vendas.

**Tarefa:** construir uma aplicação full-stack que conectasse catálogo público,
dashboard administrativo, cálculo de frete, checkout e persistência de pedidos,
mantendo o backend como fonte de verdade das regras de negócio.

**Ação:** implementei um backend Django REST com autenticação JWT, RBAC,
throttling, produtos, categorias, regiões de entrega, checkout validado no
servidor e histórico de vendas. No frontend, organizei uma aplicação Vue 3 +
TypeScript com services, composables, validação por Zod, dashboard protegido e
fluxo público de compra.

**Resultado:** o projeto entrega administração de catálogo, compra pública,
cálculo de frete, geração de pedido via WhatsApp e registro persistido para
consulta posterior. Também mantém documentação versionada e comandos de
qualidade para validar backend e frontend.

## Diferenciais Técnicos

- Backend Django REST como autoridade para preço, estoque, frete e totais.
- Frontend Vue 3 + TypeScript com services, composables e validação por Zod.
- Autenticação JWT com refresh token e throttling nos fluxos sensíveis.
- RBAC de dashboard: leitura pública, escrita administrativa por papel.
- Upload de imagens com galeria limitada e ordem preservada.
- Testes backend, typecheck, lint, testes unitários frontend e build validado.
- Documentação curta, versionada e alinhada ao código real.

## Estado Atual

O runtime canônico tem duas superfícies de código:

- `bipdelivery/`: backend canônico em Django REST. Mantém autenticação JWT,
  RBAC, lojas, produtos, categorias, regiões de entrega, checkout, PDV,
  pedidos persistidos, estoque auditado e histórico de vendas.
- `bipflow-frontend/`: aplicação Vue 3 + TypeScript. Entrega o dashboard
  autenticado, troca de loja, PDV, o catálogo público, o carrinho e o checkout.

Código não-canônico fica isolado e não participa do fluxo principal:

- `legacy/node-engine/`: motor Node/Express independente de integração de
  pedidos, **arquivado**. Ver `legacy/README.md`.
- `api-order-validation/`: pacote/test harness isolado (avaliação Jitterbit),
  mantido como artefato independente.

O sistema hoje tem base **multi-loja por coluna `store_id`**: `Store`,
`StoreMembership`, rotas públicas com `storeSlug`, seletor de loja no dashboard e
queries de negócio escopadas por loja. A loja `default` continua existindo como
fallback para links antigos e desenvolvimento local. O histórico da evolução está
em [docs/architecture/multi-tenant-evolution.md](docs/architecture/multi-tenant-evolution.md).

## Documentação Oficial

- [docs/README.md](docs/README.md): índice da documentação viva.
- [docs/technical-delivery.md](docs/technical-delivery.md): entrega técnica para
  avaliação profissional.
- [docs/architecture/system-overview.md](docs/architecture/system-overview.md):
  arquitetura real do projeto.
- [docs/architecture/multi-tenant-evolution.md](docs/architecture/multi-tenant-evolution.md):
  histórico, status e decisões da evolução multi-loja.
- [docs/development-guide.md](docs/development-guide.md): setup, comandos,
  qualidade e manutenção.
- [docs/production-go-live.md](docs/production-go-live.md): checklist
  operacional para receber pedidos reais.
- [docs/api/reference.md](docs/api/reference.md): contrato funcional da API
  Django.
- [docs/features/catalog-bot.md](docs/features/catalog-bot.md): documentação do
  bot público integrado ao catálogo.
- [bipflow-frontend/README.md](bipflow-frontend/README.md): guia específico do
  frontend.

O histórico de mudanças deve ser consultado pelo Git. Relatórios históricos,
placeholders de OpenAPI e documentos aspiracionais não são mantidos como fonte
de verdade.

## Stack

- Python 3.12.x para Django 6, alinhado ao `python:3.12-slim` do Dockerfile.
- Django 6, Django REST Framework e Simple JWT.
- SQLite em desenvolvimento local.
- Node.js 18+ e npm.
- Vue 3, TypeScript, Vite, Vue Router e Axios.
- Vitest, Cypress, ESLint, Ruff e Pytest.

## Segurança E Acesso

- Cadastro público cria uma conta comum ativa, sem poderes administrativos.
- Produtos, categorias e regiões de entrega têm leitura pública.
- Escrita administrativa exige `is_staff`, `is_superuser` ou grupo
  `admin`/`manager`.
- Histórico de vendas exige papel de dashboard: `staff`, `superuser`, `admin`,
  `manager` ou `viewer`.
- O frontend redireciona usuários sem papel de dashboard para `/403`, mas a
  proteção real fica no backend.

## Estrutura

```text
BipFlow/
|-- bipdelivery/              # Backend canônico Django REST
|-- bipflow-frontend/         # Frontend Vue 3
|-- api-order-validation/     # Pacote isolado (avaliação Jitterbit)
|-- legacy/
|   `-- node-engine/          # Motor Node arquivado (não-canônico)
|-- docs/
|   |-- api/
|   |-- architecture/         # inclui multi-tenant-evolution.md
|   `-- career/
|-- .github/workflows/        # CI (pytest + checks do frontend)
|-- Dockerfile                # Imagem do backend Django
|-- package.json              # Orquestração do monorepo (frontend + husky)
|-- requirements.txt
`-- .env.example
```

## Setup Rápido

### Docker Compose

O fluxo containerizado sobe o produto principal com frontend Vue, backend
Django, PostgreSQL e Redis:

```powershell
Copy-Item .env.example .env
python scripts\generate-secrets.py --env
docker compose up --build
```

Aplicação local: `http://localhost:8080/`
API pelo proxy do frontend: `http://localhost:8080/api/`
Admin Django pelo proxy: `http://localhost:8080/admin/`
Revisão servida pelo container: `http://localhost:8080/revision.json`

Serviços:

- `frontend`: Nginx servindo o build Vue e fazendo proxy de `/api/`, `/admin/`,
  `/static/` e `/media/`.
- `backend`: Django em Gunicorn, com migrations, `collectstatic` e seed de
  grupos RBAC no entrypoint.
- `postgres`: banco relacional do runtime containerizado.
- `redis`: cache compartilhado usado também pelos throttles do DRF.

Para criar um usuário administrativo de demonstração no primeiro boot, defina
no `.env`:

```env
DJANGO_BOOTSTRAP_ADMIN_EMAIL=admin@example.com
DJANGO_BOOTSTRAP_ADMIN_PASSWORD=troque-esta-senha
DJANGO_BOOTSTRAP_ADMIN_ROLE=admin
```

Se `localhost:8080` recusar conexão, o container `frontend` não está em
execução ou a porta está ocupada. Confira com:

```powershell
docker compose ps
docker compose logs frontend backend
```

No modo de desenvolvimento sem Docker, use o frontend em
`http://127.0.0.1:5173/` e suba o Django separadamente em
`http://127.0.0.1:8000/`.

Importante: `localhost:8080` e stacks smoke como `localhost:18088` servem um
build estatico do Vue pelo Nginx. Eles nao acompanham alteracoes salvas em
arquivos `.vue` ou `.ts`. Para atualizar esse modo, rebuild/recreate a stack:

```powershell
$env:BIPFLOW_COMMIT_SHA=(git rev-parse --short HEAD)
docker compose up -d --build --remove-orphans frontend backend
Invoke-RestMethod http://localhost:8080/revision.json
```

### Backend Django

> **Requisito:** Python **3.12 ou superior**. Django 6 não roda em Python 3.11
> ou inferior (a instalação falha por incompatibilidade de versão).

```powershell
.\bootstrap-env.ps1
Copy-Item .env.example .env
python scripts\generate-secrets.py --env
cd bipdelivery
.\venv\Scripts\python.exe manage.py migrate
.\venv\Scripts\python.exe manage.py seed_dashboard_roles --email admin@example.com --password admin123 --staff --role admin
.\venv\Scripts\python.exe manage.py runserver
```

API local: `http://127.0.0.1:8000/api/`

### Frontend Vue

```powershell
cd bipflow-frontend
npm install --ignore-scripts
Copy-Item .env.example .env.local
npm run dev
```

Se estiver usando o frontend dev em `5173` junto com Docker/Compose, reinicie
o Vite com o proxy do ambiente em vez do default `127.0.0.1:8000`:

```powershell
npm run dev:docker  # proxy para http://localhost:8080
npm run dev:smoke   # proxy para http://localhost:18088
```

Quando o catalogo em `5173` retorna 502 em `/api/v1/products/`, normalmente o
backend direto em `8000` nao esta rodando. Nesse caso, mantenha o Docker ativo
e reinicie o frontend com `dev:docker` ou `dev:smoke`, mas continue abrindo a
aplicacao de desenvolvimento em `5173`. Abra `8080` ou `18088` apenas quando
quiser validar o build estatico do container.

Aplicação local: `http://127.0.0.1:5173/`

### Motor Node Arquivado (opcional)

O motor Node não faz parte do runtime e é mantido apenas como referência em
`legacy/node-engine/`. Para executá-lo isoladamente, consulte
[`legacy/README.md`](legacy/README.md).

## Atalhos Na Raiz

```powershell
npm run frontend:dev
npm run frontend:build
npm run frontend:typecheck
npm run frontend:lint
npm run frontend:lint:fix
npm run frontend:test:unit
npm run frontend:test:e2e
npm run docs:check
npm test
```

## Qualidade

Backend:

```powershell
python bipdelivery\manage.py check
python bipdelivery\manage.py seed_dashboard_roles
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

## Convenções

- `bipdelivery/db.sqlite3`, `db.sqlite3`, `node_modules/`, uploads, logs e
  artefatos de build são dados locais e não devem entrar em commits.
- A API Django publica leitura de catálogo e exige papel administrativo para
  escrita.
- Chamadas HTTP do frontend devem passar por `src/services/`.
- Tokens JWT devem ser persistidos apenas por `token-store.ts`.
- A documentação deve acompanhar código existente, não roadmap.
