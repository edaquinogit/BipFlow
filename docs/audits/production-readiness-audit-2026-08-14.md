# Auditoria de evolucao e prontidao de producao - 2026-08-14

Este documento registra a sessao de correcao, validacao e endurecimento do
Bip Flow para uso real em uma operacao pequena com vendas fisicas e
online.

## Escopo auditado

- Login, sessao autenticada, rotas publicas e rotas protegidas do dashboard.
- Catalogo publico em `/l/default/produtos` e compartilhamento da vitrine.
- Cadastro e edicao de produtos, incluindo SKU automatico baseado no codigo QR.
- Checkout publico via WhatsApp, persistencia de pedidos e baixa de estoque.
- PDV de loja fisica, recibo e baixa de estoque.
- Infra local com Docker Compose, frontend Nginx, backend Gunicorn, PostgreSQL
  e Redis.
- Documentacao operacional de go-live e presets de ambiente.

## Alteracoes realizadas

### Catalogo publico e vitrine

- Corrigida a validacao de URL publica para aceitar origens locais seguras de
  desenvolvimento e smoke, como `localhost`, `127.0.0.1` e redes privadas.
- Mantida a rejeicao de HTTP publico fora de ambiente local, preservando a
  regra de HTTPS para producao.
- Validado o link local da vitrine:
  `http://localhost:18088/l/default/produtos`.

### Produto, SKU e QR Code

- O SKU passou a ser gerado automaticamente quando nao informado.
- O SKU automatico espelha o `public_code`, que tambem e usado no QR Code do
  produto.
- Criada migracao para preencher produtos antigos sem SKU/codigo publico.
- Removido o campo SKU dos formularios de criacao e edicao de produto para
  evitar confusao visual e reduzir erro operacional.

### Autenticacao e experiencia de sessao

- A inicializacao de autenticacao deixou de tentar refresh anonimo em paginas
  publicas sem indicio de sessao.
- O armazenamento local passou a manter apenas um marcador nao sensivel de
  sessao, evitando persistencia indevida de token.
- Rotas protegidas continuam forcando bootstrap de autenticacao quando
  necessario.
- Os testes do token store foram ajustados para serem incluidos na suite do
  Vitest.

### Infra, assets e proxy

- O Nginx do frontend agora retorna `404` para assets inexistentes, em vez de
  devolver `index.html` com MIME incorreto.
- O `index.html` passou a ser servido com politica `no-store`, reduzindo risco
  de chunk antigo apos deploy.
- O roteador do frontend passou a recarregar uma unica vez quando encontra
  falha de import dinamico de chunk.
- O proxy de desenvolvimento do Vite passou a ler ambiente via `loadEnv`, com
  alvo padrao compativel com backend Docker em `127.0.0.1:8000`.
- Foram adicionados presets/scripts de ambiente para smoke local e Docker.

### Prontidao da loja

- A verificacao de go-live passou a considerar o WhatsApp efetivo da loja ativa,
  incluindo fallback de `StoreSettings` e ambiente quando aplicavel.
- A tela de configuracoes da loja passou a refletir o telefone efetivo quando o
  registro singleton ainda nao contem valor proprio.
- O readiness check validou catalogo ativo, estoque, regiao de entrega e canal
  de contato antes de liberar operacao.

### Pedidos e referencias

- Corrigida a geracao de `order_reference` para reduzir risco de colisao sob
  carga concorrente.
- Checkout online e PDV passaram a usar uma referencia legivel com sufixo
  aleatorio.
- A auditoria encontrou uma falha real de colisao durante carga concorrente; a
  correcao foi aplicada e a carga foi repetida com sucesso.

## Evidencias de validacao

### Backend

- `python bipdelivery\manage.py check`: aprovado.
- `ruff check bipdelivery`: aprovado.
- `python -m pytest bipdelivery/tests`: 486 testes aprovados.

### Frontend

- `npm --prefix bipflow-frontend run lint`: aprovado.
- `npm --prefix bipflow-frontend run typecheck`: aprovado.
- `npm --prefix bipflow-frontend run test:unit`: 82 arquivos e 555 testes
  aprovados.
- Cypress: 10 specs e 27 testes E2E aprovados.

### Documentacao

- `npm run docs:check`: aprovado, 0 problemas encontrados.

### Docker e Compose

- `docker compose config --quiet`: aprovado.
- `docker-compose.prod.yml config --quiet`: aprovado com segredos placeholder.
- Stack smoke local saudavel em:
  - Aplicacao: `http://localhost:18088`
  - Vitrine: `http://localhost:18088/l/default/produtos`
  - Dashboard: `http://localhost:18088/dashboard`
- Servicos validados como healthy: frontend, backend, PostgreSQL e Redis.
- Logs revisados sem `ERROR`, `Traceback`, `500` ou `UniqueViolation` apos a
  correcao final.

### Fluxos funcionais

- Produto criado sem SKU: SKU gerado automaticamente igual ao codigo publico.
- Checkout online criado com sucesso, pedido persistido e estoque decrementado.
- Venda PDV criada com sucesso, pedido persistido e estoque decrementado.
- Historico registrou canais `virtual` e `loja_fisica`.

### Smoke de carga local

- 200 leituras do catalogo publico: 200 OK, p95 537 ms.
- 80 checkouts online concorrentes: 80 OK, p95 758 ms.
- 40 vendas PDV concorrentes: 40 OK, p95 224 ms.
- 100 leituras de resumo do dashboard: 100 OK, p95 181 ms.
- Estoque reconciliado exatamente ao final da carga: esperado 180, obtido 180.

## Parecer de prontidao

O projeto esta aprovado para piloto de producao controlado e atende, no ambiente
validado, a uma operacao pequena com cerca de 200 pedidos semanais e faturamento
bruto mensal na faixa de R$ 10 mil, desde que o deploy real siga o checklist de
go-live e use servicos persistentes de producao.

A aplicacao cobre vendas online por vitrine/WhatsApp e vendas fisicas por PDV,
com persistencia de pedidos, baixa de estoque, historico e separacao de canais.

## Condicoes obrigatorias antes de venda real

- Configurar dominio HTTPS canonico para frontend/backend.
- Definir `DJANGO_ENV=production`, `DEBUG=False`, `DJANGO_SECRET_KEY` forte,
  hosts, CORS e CSRF restritos ao dominio real.
- Usar PostgreSQL e Redis gerenciados ou operados com backup, restore testado e
  retencao definida.
- Persistir imagens fora de container efemero, preferencialmente R2/S3
  compativel.
- Configurar Turnstile real, SMTP real e telefone WhatsApp operacional.
- Ter logs acessiveis, alerta minimo de erro, rotina de rollback e plano de
  restauracao de banco.
- Homologar o fluxo real de atendimento no WhatsApp, entrega e operacao fiscal
  exigida pelo negocio.

## Observacoes responsaveis

- A stack local de smoke usou limites elevados de throttle e captcha facilitado
  apenas para testes automatizados; os defaults de producao permanecem
  restritivos.
- Os testes de carga foram locais e funcionais. Antes de aumento de escala,
  repetir carga no provedor real com banco, Redis, dominio e storage finais.
- Integracoes externas de pagamento, emissao fiscal e mensageria ativa devem ser
  homologadas separadamente caso sejam adicionadas ao processo comercial.

## Commit tecnico base

- Codigo validado e publicado em `6f6151c fix(production): harden storefront
  order readiness`.
