# Visao Geral Da Arquitetura

Este documento descreve a arquitetura implementada hoje no repositorio.

## Fluxo Principal

```text
Usuario administrativo ou cliente publico
  |
  v
Frontend Vue 3 (bipflow-frontend)
  |
  | HTTP JSON ou multipart + X-Store-Slug quando a loja e explicita
  v
Backend Django REST (bipdelivery)
  |
  | resolve_request_store() / ORM / File storage local em desenvolvimento
  v
SQLite + MEDIA_ROOT por ambiente local
```

O caminho acima e o produto principal: dashboard autenticado, catalogo publico,
carrinho, frete por regiao, checkout, PDV, estoque auditado e historico de
vendas. Em producao, media deve usar R2/S3 compativel e o banco deve ser
PostgreSQL.

## Sistemas Separados

O runtime canonico e exclusivamente Django (backend) + Vue (frontend). Codigo
nao-canonico fica isolado e nao participa do fluxo principal:

- `legacy/node-engine/`: motor Node/Express independente de integracao de
  pedidos, **arquivado** na Fase 0 da evolucao multi-loja. Ver
  `legacy/README.md`.
- `api-order-validation/`: pacote/test harness isolado (avaliacao Jitterbit),
  mantido como artefato independente.

## Estado Multi-Loja

O sistema deixou de ser single-tenant puro. O backend possui `Store`,
`StoreMembership` e um unico ponto de resolucao de tenant em
`bipdelivery/api/store_scope.py`. As tabelas de negocio principais possuem
`store_id`; endpoints de catalogo, estoque, pedidos, bot, checkout e PDV sao
filtrados pela loja resolvida. A loja `default` permanece como fallback para
links antigos e desenvolvimento local.

`architecture/multi-tenant-evolution.md` registra o historico e as fases dessa
evolucao.

## Frontend Vue

Responsabilidades:

- proteger o dashboard por guarda de rota autenticada e papel de dashboard;
- exibir saudacao com o usuario retornado por `GET /api/auth/me/`;
- resolver loja atual e permitir troca entre lojas do usuario;
- listar e gerenciar produtos no dashboard;
- registrar vendas de balcao no PDV por QR/codigo publico;
- abrir menu operacional com historico de vendas, alertas de estoque, atalhos e
  gestao de regioes de entrega e WhatsApp da loja;
- expor catalogo publico em `/produtos` e em rotas por loja
  `/l/:storeSlug/produtos`;
- carregar regioes ativas de entrega no carrinho;
- manter carrinho local separado por loja;
- exibir o WhatsApp publico da loja e abrir duvidas frequentes com mensagem
  pronta para `api.whatsapp.com/send`;
- enviar checkout para a API Django e abrir o fluxo de WhatsApp;
- reutilizar perfil de cliente por loja quando o comprador esta autenticado.

Camadas relevantes:

- `src/services/`: acesso HTTP e contratos de API.
- `src/composables/`: estado reutilizavel.
- `src/views/dashboard/`: experiencia administrativa.
- `src/views/products/`: catalogo publico, detalhe e checkout.
- `src/types/` e `src/schemas/`: contratos compartilhados no frontend.

## Backend Django

Responsabilidades:

- autenticar via JWT;
- expor perfil autenticado em `auth/me`;
- aplicar RBAC de dashboard com `is_staff`, `is_superuser` e grupos
  `admin`/`manager`/`viewer`;
- aplicar throttling em endpoints sensiveis de auth;
- resolver a loja da request por JWT, `X-Store-Slug` ou fallback `default`;
- manter lojas, memberships e configuracoes por loja;
- manter produtos, categorias e galerias de imagens;
- gerar `public_code` imutavel e QR de etiqueta para produtos;
- registrar movimentacoes de estoque e impedir saida maior que o saldo;
- manter regioes de entrega e taxa por regiao;
- manter configuracoes operacionais da loja, incluindo WhatsApp de atendimento;
- responder mensagens do bot MVP sem IA por regras deterministicas;
- persistir conversas e mensagens do bot em `BotConversation` e `BotMessage`;
- manter a configuracao comercial por loja (`StoreCommerceSettings`: aceita
  pedidos, modalidades de entrega, formas de pagamento, pedido minimo);
- validar checkout no servidor, incluindo as regras comerciais da loja;
- persistir pedidos como `SaleOrder` e `SaleOrderItem`;
- manter o ciclo de vida de pagamento do pedido (`payment_status`) com
  auditoria append-only em `PaymentStatusEvent` e maquina de estados em
  `bipdelivery/api/payments.py`;
- expor historico de vendas para usuarios com papel de dashboard;
- registrar vendas de PDV (nascem pagas) e enviar recibo PDF por email;
- validar transicoes de pedido, incluindo envio, entrega e cancelamento com
  estorno de estoque e liquidacao de pagamento.

Arquivos principais:

- `bipdelivery/api/models.py`
- `bipdelivery/api/bot_engine.py`
- `bipdelivery/api/serializers.py`
- `bipdelivery/api/views.py`
- `bipdelivery/api/payments.py`
- `bipdelivery/api/pdv.py`
- `bipdelivery/api/store_scope.py`
- `bipdelivery/api/v1_urls.py`
- `bipdelivery/core/settings.py`

## Contratos Principais

Produtos:

- `/api/v1/products/`
- leitura publica;
- escrita por `staff`, `superuser`, `admin` ou `manager`;
- filtros por busca, categoria, estoque e preco;
- detalhe publico por slug em `/api/v1/products/by-slug/{slug}/`;
- detalhe publico por codigo em `/api/v1/products/by-code/{code}/`;
- QR individual e em lote para usuarios de dashboard;
- historico e ajuste manual de estoque por produto;
- ate 3 imagens por produto.

Lojas:

- `/api/v1/store/current/` resolve a loja da request;
- `/api/v1/store/mine/` lista ou cria lojas do usuario autenticado;
- `/api/v1/store/mine/{slug}/` renomeia loja para owner/manager;
- `/api/v1/store/mine/{slug}/receipt-settings/` atualiza politica e formato de
  recibo do PDV.

Categorias:

- `/api/v1/categories/`
- leitura publica;
- escrita por `staff`, `superuser`, `admin` ou `manager`;
- exclusao bloqueada quando ha produtos associados.

Regioes de entrega:

- `/api/v1/delivery-regions/`
- leitura publica mostra apenas regioes ativas para usuarios anonimos e
  autenticados sem papel de dashboard;
- usuarios com papel de dashboard veem todas;
- `staff`, `superuser`, `admin` e `manager` gerenciam;
- `/api/v1/delivery-regions/active/` alimenta o carrinho publico.

Configuracoes da loja:

- `/api/v1/store-settings/` e privado para papeis de dashboard;
- `/api/v1/store-settings/public/` expoe somente `whatsapp_phone_digits` e
  `is_whatsapp_configured`;
- o catalogo usa esse contrato minimo para mostrar o contato e montar mensagens
  pre-preenchidas de duvidas frequentes;
- o checkout prioriza o numero salvo no dashboard e usa `WHATSAPP_ORDER_PHONE`
  apenas como fallback.

Bot MVP:

- `/api/v1/bot/messages/` recebe mensagens publicas;
- `/api/v1/bot-conversations/` expoe historico apenas para papel de dashboard;
- sem IA e sem provedor externo nesta fase;
- classifica mensagens por regras para saudacao, catalogo, busca de produto,
  entrega, checkout, atendimento humano e fallback;
- persiste mensagens do cliente e respostas do bot;
- retorna `conversation_id` e `session_id` para continuidade da conversa;
- consulta produtos disponiveis e regioes ativas sem duplicar regra de negocio.
- documentacao da feature:
  [docs/features/catalog-bot.md](../features/catalog-bot.md).

Configuracao comercial:

- `/api/v1/store/current/commerce-settings/` (dashboard, escrita
  `owner`/`manager`);
- `/api/v1/public/stores/{slug}/commerce-settings/` (projecao sanitizada
  para a vitrine);
- `StoreCommerceSettings` (`OneToOneField(Store)` + `get_for_store()`),
  detalhado em
  [docs/architecture/online-sales-foundation.md](./online-sales-foundation.md).

Checkout:

- `/api/v1/checkout/whatsapp/`
- publico;
- recalcula totais no backend;
- aplica as regras comerciais da loja (aceita pedidos, modalidade,
  pagamento, pedido minimo, regiao) antes de qualquer efeito colateral,
  com codigos de rejeicao estaveis (HTTP 422);
- usa taxa da regiao de entrega quando enviada;
- persiste pedido e itens; o pedido virtual nasce `payment_status=pending`;
- retorna mensagem e URL `wa.me` quando houver WhatsApp configurado no
  dashboard ou fallback em `WHATSAPP_ORDER_PHONE`.

Vendas:

- `/api/v1/sales-orders/`
- somente papel de dashboard;
- listagem e detalhe para papeis de dashboard;
- atualizacao de status operacional e de pagamento (`.../payment/`) para
  papeis com escrita operacional;
- suporta filtros `status`, `search`, `channel` e `payment_status`;
- agregados de dashboard em `summary`, `timeseries`, `breakdown` e
  `customers`, com `summary`/`breakdown` separando receita confirmada
  (`paid_*`) de volume de pedidos.

PDV:

- `/api/v1/pdv/sales/`;
- registra venda de loja fisica por `public_code`;
- baixa estoque de forma atomica;
- persiste `SaleOrder` com canal `loja_fisica`;
- `/api/v1/pdv/sales/{order_reference}/receipt-email/` envia recibo PDF gerado
  pelo frontend.

## Decisoes Arquiteturais

- O backend e a autoridade para preco, estoque, disponibilidade, frete e total.
- O escopo de loja fica no backend; o frontend apenas informa o `storeSlug`
  quando a rota ou o seletor de loja tornam isso explicito.
- O backend e a barreira de seguranca: cadastro publico nao concede papel de
  dashboard nem permissao de escrita.
- O frontend nao grava tokens fora de `token-store.ts`.
- O frontend nao deve espalhar chamadas `axios` fora de `src/services/`.
- O dashboard consome historico de vendas persistido pelo checkout publico.
- O PDV e o checkout compartilham o mesmo historico de pedidos, mas canais e
  regras de captura sao separados.
- Regra comercial (aceitar pedidos, modalidade, pagamento, minimo) e ciclo de
  pagamento vivem no backend; o frontend so filtra opcoes e mostra avisos.
- O Bip Flow nao processa pagamento nem executa reembolso: `payment_status`
  e movido por operador ou pelas transicoes automaticas do PDV e do
  cancelamento.
- O bot do catalogo deve continuar fino no frontend: UI chama service, service
  chama API, backend classifica e consulta dados reais.
- Documentacao deve representar o codigo atual e ser removida quando virar
  placeholder, relatorio historico ou plano nao implementado.
