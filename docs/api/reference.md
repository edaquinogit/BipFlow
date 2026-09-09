# Referencia Da API Django

Contrato funcional dos endpoints implementados em `bipdelivery/api/`.

## Base

Local:

```text
http://127.0.0.1:8000/api/
```

API versionada:

```text
/api/v1/
```

Esta referencia descreve apenas a API canonica Django. O motor Node arquivado em
`legacy/node-engine/` (Swagger em `/api-docs`) nao faz parte do runtime e nao e
coberto aqui.

## Autenticacao

O backend usa Simple JWT. O frontend guarda `access_token` e `refresh_token`
somente via `bipflow-frontend/src/services/token-store.ts`.

### Login

```http
POST /api/auth/token/
```

```json
{
  "username": "admin@example.com",
  "password": "senha"
}
```

Resposta:

```json
{
  "access": "jwt-access",
  "refresh": "jwt-refresh"
}
```

### Usuario autenticado

```http
GET /api/auth/me/
Authorization: Bearer <access>
```

Resposta:

```json
{
  "id": 1,
  "username": "admin@example.com",
  "email": "admin@example.com",
  "first_name": "Ednaldo",
  "last_name": "Aquino",
  "display_name": "Ednaldo Aquino",
  "is_staff": true,
  "is_superuser": false,
  "roles": ["staff"],
  "can_access_dashboard": true,
  "can_manage_catalog": true
}
```

`display_name` usa nome completo quando existe; caso contrario, usa a parte
local do email ou o `username`.

Os campos `roles`, `can_access_dashboard` e `can_manage_catalog` expoem o RBAC
usado pelo dashboard. O acesso tambem pode vir de `StoreMembership` com papel
`owner`, `manager` ou `viewer`, alem dos grupos globais mantidos para
compatibilidade.

### Renovar token

```http
POST /api/auth/token/refresh/
```

```json
{
  "refresh": "jwt-refresh"
}
```

### Cadastro

```http
POST /api/auth/register/
```

```json
{
  "email": "admin@example.com",
  "password": "senha-segura",
  "confirm_password": "senha-segura",
  "registration_context": "dashboard_owner",
  "store_name": "Minha Loja"
}
```

O cadastro cria conta ativa. Por padrao, `registration_context` e
`dashboard_owner`: o backend cria a primeira `Store` e um `StoreMembership`
`owner`, liberando acesso ao dashboard daquela loja.

Para cadastro de cliente da vitrine, envie `registration_context` como
`storefront_customer`, `store_slug`, `full_name` e `phone`. Nesse caso o backend
cria apenas o perfil de cliente daquela loja, sem acesso ao dashboard.

### Reset de senha

```http
POST /api/auth/password-reset/
POST /api/auth/password-reset/confirm/
```

O reset evita enumeracao de contas e usa token assinado do Django.

### Throttling de auth

| Escopo | Endpoints | Padrao |
| --- | --- | --- |
| IP sensivel | login, cadastro, reset e confirmacao de reset | `10/minute` |
| Login por identidade | `username` ou `email` submetido | `5/minute` |
| Cadastro por email | `email` submetido | `3/hour` |
| Reset por email | `email` submetido | `3/hour` |
| Confirmacao por uid | `uid` submetido | `5/hour` |
| Refresh por IP | token refresh | `30/minute` |
| Refresh por token | `refresh` submetido | `10/minute` |

Quando o limite e excedido, a API retorna `429 Too Many Requests`.

## Permissoes

- Produtos, categorias e regioes de entrega: leitura publica, escrita apenas
  para `is_staff`, `is_superuser`, usuarios nos grupos `admin`/`manager` ou
  membros `owner`/`manager` da loja resolvida.
- Regioes de entrega para usuario anonimo: somente regioes ativas.
- Configuracoes da loja: leitura administrativa para papeis de dashboard;
  escrita apenas para `is_staff`, `is_superuser` ou usuarios nos grupos
  `admin`/`manager` ou membros `owner`/`manager`. O catalogo publico consome
  somente o endpoint seguro `/api/v1/store-settings/public/`.
- Checkout WhatsApp: publico.
- Historico de vendas: leitura para `is_staff`, `is_superuser` ou usuarios
  nos grupos `admin`/`manager`/`viewer` ou membros `owner`/`manager`/`viewer`;
  atualizacao de status para `is_staff`, `is_superuser`, `admin`, `manager`,
  `owner` ou `manager` de loja.

## Escopo De Loja

A API canonica e multi-loja por coluna `store_id`.

- Rotas publicas podem enviar `X-Store-Slug` para resolver uma loja especifica.
- Rotas autenticadas usam o `store_id` carregado no JWT e tambem aceitam
  `X-Store-Slug` para troca de loja, desde que o usuario pertenca a ela.
- Quando nada e enviado, a loja `default` e usada como fallback.
- Queries de catalogo, estoque, pedidos, bot, checkout e PDV sao sempre
  filtradas pela loja resolvida.

```http
GET /api/v1/store/current/
GET /api/v1/store/mine/
POST /api/v1/store/mine/
PATCH /api/v1/store/mine/{slug}/
PATCH /api/v1/store/mine/{slug}/receipt-settings/
```

`store/current` e publico e retorna a loja resolvida. `store/mine` exige
autenticacao, lista as lojas do usuario e cria uma nova loja como `owner`.
Renomear loja e alterar configuracao de recibo exigem papel `owner` ou
`manager` naquela loja.

Campos principais de loja:

- `id`
- `name`
- `slug`
- `logo_url`
- `tagline`
- `whatsapp_phone`
- `theme`
- `is_active`
- `status`
- `receipt_exchange_policy`
- `receipt_paper_format`

## Paginacao

Respostas paginadas usam este formato:

```json
{
  "count": 1,
  "next": null,
  "previous": null,
  "page_size": 20,
  "total_pages": 1,
  "results": []
}
```

Produtos usam `page_size` padrao 12 e maximo 50. As demais listas usam padrao
20 e maximo 100.

## Produtos

```http
GET /api/v1/products/
POST /api/v1/products/
GET /api/v1/products/{id}/
PATCH /api/v1/products/{id}/
DELETE /api/v1/products/{id}/
GET /api/v1/products/by-slug/{slug}/
GET /api/v1/products/by-code/{code}/
GET /api/v1/products/{id}/qr-code/
GET /api/v1/products/qr-codes-bulk/
GET /api/v1/products/{id}/stock-movements/
POST /api/v1/products/{id}/stock-movements/
PATCH /api/v1/products/bulk_update_category/
```

Leitura e publica. Escrita exige `staff`, `superuser`, grupo `admin` ou grupo
`manager`, ou papel `owner`/`manager` na loja resolvida.

Query params de listagem:

- `search`
- `category` por id ou slug
- `in_stock` com `true`, `false`, `1`, `0`, `yes` ou `no`
- `min_price`
- `max_price`
- `page`
- `page_size`

Campos principais:

- `id`
- `sku`
- `public_code`
- `name`
- `slug`
- `description`
- `price`
- `size`
- `stock_quantity`
- `low_stock_threshold`
- `is_available`
- `image`
- `images`
- `category`
- `category_name`
- `created_at`

Contrato de escrita:

- `POST` exige `name`, `price`, `stock_quantity` e `category`;
- `category` deve ser o ID numerico de uma categoria existente;
- `price` aceita valor decimal;
- `stock_quantity` deve ser inteiro nao negativo;
- `sku` e opcional; quando vem vazio/ausente, o backend usa o mesmo
  `public_code` gerado para o QR;
- `public_code` e `slug` sao somente leitura;
- `PATCH` aceita atualizacao parcial, mas o dashboard envia o formulario
  normalizado com os campos de negocio atuais.

Upload e galeria:

- aceita JSON ou `multipart/form-data`;
- `image` define a capa;
- `uploaded_images` e `existing_images` controlam galeria;
- o frontend envia slots ordenados como `existing_images[0]`,
  `uploaded_images[1]` e assim por diante para preservar ordem visual;
- cada produto pode ter no maximo 3 imagens.

Atualizacao em lote:

```json
{
  "product_ids": [1, 2, 3],
  "new_category_id": 5
}
```

Codigo publico e QR:

- `public_code` e gerado automaticamente, imutavel e unico por loja;
- produtos sem SKU manual recebem `sku = public_code` automaticamente;
- `/by-code/{code}/` e publico, case-insensitive e escopado pela loja;
- `/{id}/qr-code/` retorna `public_code`, URL publica e PNG em data URI;
- `/qr-codes-bulk/?ids=1,2,3` retorna etiquetas em lote para dashboard.

Movimentacoes de estoque:

```json
{
  "movement_type": "entrada",
  "quantity": 5,
  "reason": "ajuste_inventario",
  "notes": "Contagem fisica"
}
```

Regras:

- leitura do historico exige papel de dashboard;
- criacao exige papel de escrita;
- `saida` nao pode deixar estoque negativo;
- checkout, PDV e cancelamento tambem criam movimentacoes de auditoria;
- edicao direta de `stock_quantity` em `PATCH /products/{id}/` e rejeitada.

## Categorias

```http
GET /api/v1/categories/
POST /api/v1/categories/
GET /api/v1/categories/{id}/
PUT /api/v1/categories/{id}/
PATCH /api/v1/categories/{id}/
DELETE /api/v1/categories/{id}/
```

Leitura e publica. Escrita exige `staff`, `superuser`, grupo `admin`/`manager`
ou papel `owner`/`manager` na loja resolvida.

Campos:

- `id`
- `name`
- `slug`
- `description`

Se houver produtos associados, a remocao retorna erro de regra de negocio.

## Regioes De Entrega

```http
GET /api/v1/delivery-regions/
POST /api/v1/delivery-regions/
GET /api/v1/delivery-regions/{id}/
PATCH /api/v1/delivery-regions/{id}/
DELETE /api/v1/delivery-regions/{id}/
GET /api/v1/delivery-regions/active/
```

Campos:

- `id`
- `name`
- `city`
- `neighborhoods`
- `delivery_fee`
- `is_active`
- `created_at`
- `updated_at`

Notas:

- usuarios anonimos e autenticados sem papel de dashboard recebem apenas
  regioes ativas;
- usuarios com papel de dashboard veem todas;
- somente `staff`, `superuser`, grupo `admin`/`manager` ou papel
  `owner`/`manager` cria, edita e remove regioes;
- o carrinho publico usa `/active/` para calcular frete.

## Configuracoes Operacionais De WhatsApp

```http
GET /api/v1/store-settings/
PATCH /api/v1/store-settings/
GET /api/v1/store-settings/public/
```

Payload de escrita:

```json
{
  "whatsapp_phone": "+55 71 99999-9999"
}
```

Campos:

- `id`
- `whatsapp_phone`
- `whatsapp_phone_digits`
- `is_whatsapp_configured`
- `created_at`
- `updated_at`

Resposta publica:

```json
{
  "whatsapp_phone_digits": "5571999999999",
  "is_whatsapp_configured": true
}
```

Notas:

- o backend aceita numero formatado, mas persiste somente digitos;
- o WhatsApp deve incluir codigo do pais e DDD;
- o catalogo publico usa apenas `whatsapp_phone_digits` para exibir o contato
  e montar atalhos de duvidas frequentes;
- o checkout prioriza o WhatsApp da loja resolvida e usa `WHATSAPP_ORDER_PHONE`
  como fallback quando ainda nao ha numero cadastrado;
- configuracoes ricas por loja, como nome, slug e recibo de PDV, ficam nos
  endpoints `store/current` e `store/mine`.

## Configuracao Comercial Da Loja

Regras comerciais por loja (online-sales foundation): se aceita pedidos,
modalidades de entrega, formas de pagamento e pedido minimo.

```http
GET /api/v1/store/current/commerce-settings/
PATCH /api/v1/store/current/commerce-settings/
GET /api/v1/public/stores/{slug}/commerce-settings/
```

`store/current` exige autenticacao: qualquer membro le, somente
`owner`/`manager` (ou staff) edita. O tenant vem do contexto autenticado
(claim JWT / header `X-Store-Slug`), nunca de um `store_id` no payload.

Payload de escrita (parcial):

```json
{
  "orders_enabled": true,
  "delivery_enabled": true,
  "pickup_enabled": false,
  "minimum_order_value": "50.00",
  "accepts_pix": true,
  "accepts_card": true,
  "accepts_cash": false
}
```

Campos (dashboard):

- `orders_enabled`
- `delivery_enabled`
- `pickup_enabled`
- `minimum_order_value`
- `accepts_pix`
- `accepts_card`
- `accepts_cash`
- `enabled_delivery_methods` (read-only, derivado)
- `enabled_payment_methods` (read-only, derivado)
- `created_at`
- `updated_at`

Invariantes (HTTP 400 com chave de campo, tambem `CheckConstraint` no banco):

- `minimum_order_value` nunca negativo;
- com `orders_enabled=true`, ao menos uma modalidade de entrega;
- com `orders_enabled=true`, ao menos uma forma de pagamento.

Resposta publica (`public/stores/{slug}/commerce-settings/`, loja ativa,
sem auth, nao cria linha):

```json
{
  "orders_enabled": true,
  "delivery_enabled": true,
  "pickup_enabled": false,
  "minimum_order_value": "50.00",
  "accepts_pix": true,
  "accepts_card": true,
  "accepts_cash": false,
  "delivery_methods": ["delivery"],
  "payment_methods": ["pix", "card"]
}
```

Defaults preservam o comportamento anterior (tudo habilitado, sem minimo).
Uma loja criada pelo onboarding ja recebe a linha; lojas antigas usam
`get_for_store()` sob demanda.

## Perfil De Cliente

```http
GET /api/v1/customers/me/
PATCH /api/v1/customers/me/
```

Exige autenticacao de cliente da vitrine. O perfil e escopado por loja e nunca
concede acesso ao dashboard.

Campos:

- `full_name`
- `phone`
- `address`
- `neighborhood`
- `city`
- `delivery_region_id`
- `delivery_region_name`
- `email`

Regras:

- `full_name` e `phone` nao podem ser salvos em branco quando enviados;
- `delivery_region_id`, quando enviado, precisa pertencer a loja resolvida e
  estar ativo;
- no checkout, perfil completo vence os dados enviados como convidado; campos
  de convidado sao usados apenas como fallback.

## Bot MVP Sem IA

```http
POST /api/v1/bot/messages/
```

Endpoint publico para a primeira fatia do bot guiado por regras. Ele nao chama
IA nem conversa com provedor WhatsApp externo, mas persiste conversas e
mensagens em `BotConversation` e `BotMessage`.

Documento de feature:
[docs/features/catalog-bot.md](../features/catalog-bot.md).

Payload:

```json
{
  "message": "Quero ver o catalogo",
  "channel": "web",
  "session_id": "opcional-para-continuar-conversa",
  "conversation_id": 1,
  "customer_phone": "5571999999999"
}
```

`channel`, `session_id`, `conversation_id` e `customer_phone` sao opcionais.
`channel` aceita `web` ou `whatsapp`. Quando nenhum identificador de conversa e
enviado, o backend cria uma conversa nova e devolve `conversation_id` e
`session_id`.

Resposta:

- `intent`: `greeting`, `catalog`, `product_search`, `delivery`, `checkout`,
  `human_support` ou `fallback`;
- `conversation_id`: identificador interno da conversa persistida;
- `session_id`: identificador publico opaco para continuidade no cliente;
- `conversation_status`: `waiting_customer` ou `waiting_human` nesta fase;
- `reply`: texto curto para exibir ao cliente;
- `options`: atalhos guiados que o frontend pode renderizar;
- `products`: sugestoes compactas de produtos disponiveis;
- `delivery_regions`: regioes ativas de entrega.

Regras:

- mensagens vazias sao rejeitadas;
- catalogo e busca retornam apenas produtos disponiveis e com estoque;
- entrega retorna apenas regioes ativas;
- cada mensagem util salva uma mensagem `user` e uma mensagem `bot`;
- mensagens seguintes com `conversation_id` ou `session_id` reutilizam a mesma
  conversa;
- pedidos de atendimento humano mudam a conversa para `waiting_human`;
- checkout orienta o cliente a finalizar pelo carrinho, mantendo preco, estoque,
  frete e total sob responsabilidade do backend.
- novas intents devem atualizar backend, serializers, types do frontend, testes
  e esta referencia no mesmo ciclo da mudanca.

## Conversas Do Bot

```http
GET /api/v1/bot-conversations/
GET /api/v1/bot-conversations/{id}/
```

Endpoint read-only para usuarios com papel de dashboard. A listagem retorna um
resumo das conversas persistidas; o detalhe inclui as mensagens.

O dashboard consome este contrato na vitrine do chatbot. Essa UI abre sob
demanda, carrega dados de forma lazy e nao cria ou altera conversas.

Filtros:

- `status`: `open`, `waiting_customer`, `waiting_human` ou `closed`;
- `channel`: `web` ou `whatsapp`;
- `intent`: ultima intent registrada, como `human_support` ou `delivery`;
- `search`: busca por `session_id`, telefone do cliente ou conteudo das
  mensagens.

Campos da listagem:

- `id`
- `session_id`
- `channel`
- `customer_phone`
- `status`
- `last_intent`
- `message_count`
- `last_message_preview`
- `created_at`
- `updated_at`

O detalhe adiciona `messages`, com `role`, `content`, `intent`, `metadata` e
`created_at`.

## Checkout Via WhatsApp

```http
POST /api/v1/checkout/whatsapp/
```

Payload:

```json
{
  "items": [
    {
      "product_id": 1,
      "quantity": 2
    }
  ],
  "customer": {
    "full_name": "Cliente Teste",
    "phone": "(71) 99999-0000",
    "email": "cliente@example.com",
    "delivery_method": "delivery",
    "payment_method": "pix",
    "delivery_region_id": 3,
    "address": "Rua A, 123",
    "neighborhood": "Centro",
    "city": "Salvador",
    "notes": "Sem cebola"
  }
}
```

Regras:

- `items` nao pode ser vazio;
- produtos precisam existir, estar disponiveis e ter estoque;
- produtos e regioes sao resolvidos dentro da loja atual;
- quando o usuario autenticado possui perfil de cliente completo para a loja,
  identidade e endereco do perfil vencem os campos de convidado enviados;
- entrega exige `address`, `neighborhood` e `city`;
- quando `delivery_region_id` ativo e enviado, o backend usa a taxa da regiao;
- sem regiao enviada, entrega usa `ORDER_DELIVERY_FEE`;
- retirada usa taxa `0.00`;
- o pedido e persistido em `SaleOrder` com itens em `SaleOrderItem`;
- `order_reference` segue o prefixo `BPF`;
- todo pedido virtual nasce com `payment_status="pending"`;
- `whatsapp_url` aponta para o WhatsApp da loja configurado no dashboard.

Rejeicoes de regra comercial (online-sales foundation) — HTTP 422 com corpo
`{"code", "detail"}`, aplicadas antes de criar pedido, mexer em estoque ou
consumir chave de idempotencia:

- `store_not_accepting_orders` — loja inativa ou `orders_enabled=false`;
- `delivery_method_unavailable` — modalidade escolhida desabilitada;
- `payment_method_unavailable` — forma de pagamento nao aceita;
- `minimum_order_not_reached` — subtotal recalculado abaixo do minimo;
- `delivery_region_unavailable` — regiao inativa ou de outra loja.

Um retry idempotente de um pedido que ja existe devolve o pedido mesmo que a
loja tenha fechado nesse meio-tempo.

Resposta:

- `order_reference`
- `items`
- `customer`
- `subtotal`
- `delivery_fee`
- `total`
- `message`
- `whatsapp_url`

## PDV De Balcao

```http
POST /api/v1/pdv/sales/
POST /api/v1/pdv/sales/{order_reference}/receipt-email/
```

`pdv/sales` exige autenticacao e papel de escrita de dashboard. Ele registra uma
venda presencial usando `public_code`, baixa estoque de forma atomica e persiste
um `SaleOrder` com canal `loja_fisica`. A venda nasce ja paga
(`payment_status="paid"`, com `paid_at` e um evento de auditoria `system`).

Payload:

```json
{
  "items": [
    {
      "public_code": "ABCD2345",
      "quantity": 2
    }
  ],
  "payment_method": "pix",
  "customer_name": "Cliente balcao",
  "customer_phone": "5571999999999",
  "customer_email": "cliente@example.com",
  "notes": "Venda no caixa"
}
```

Resposta principal:

- `order_reference`
- `items`
- `subtotal`
- `total`
- `payment_method`
- `created_at`
- `customer_email`

Regras:

- `items` nao pode ser vazio;
- `public_code` e resolvido dentro da loja atual;
- produtos indisponiveis, sem estoque ou de outra loja sao rejeitados;
- linhas repetidas sao agregadas antes da reserva de estoque;
- o pedido e os movimentos de estoque sao gravados na mesma transacao.

Envio de recibo:

```json
{
  "email": "cliente@example.com",
  "pdf_base64": "JVBERi0x..."
}
```

O PDF e gerado no frontend e enviado como base64. O backend valida tamanho
maximo de 5 MB, assinatura de PDF e escopo do pedido antes de enviar o email.

## Historico De Vendas

```http
GET /api/v1/sales-orders/
GET /api/v1/sales-orders/{id}/
PATCH /api/v1/sales-orders/{id}/status/
PATCH /api/v1/sales-orders/{id}/payment/
GET /api/v1/sales-orders/summary/
GET /api/v1/sales-orders/timeseries/
GET /api/v1/sales-orders/breakdown/
GET /api/v1/sales-orders/customers/
```

Listagem e detalhe exigem papel de dashboard. Atualizacao de status exige papel
de escrita (`staff`, `superuser`, `admin`, `manager`, `owner` ou `manager` de
loja).

Query params:

- `status`
- `channel`
- `payment_status`
- `search`
- `period`
- `start`
- `end`
- `page`
- `page_size`

Campos principais:

- `id`
- `order_reference`
- `status`
- `channel`
- `customer_name`
- `customer_phone`
- `customer_email`
- `delivery_method`
- `payment_method`
- `payment_status`
- `paid_at`
- `subtotal`
- `delivery_fee`
- `delivery_region_name`
- `total`
- `created_at`
- `item_count`
- `items`
- `performed_by_username`

O detalhe adiciona:

- `address`
- `neighborhood`
- `city`
- `notes`
- `message`
- `whatsapp_url`
- `carrier_name`
- `tracking_code`
- `tracking_url`
- `shipped_at`
- `delivered_at`
- `refunded_at`
- `payment_reference`
- `payment_status_events` (auditoria append-only: `previous_status`,
  `new_status`, `source`, `performed_by_username`, `reference`, `note`,
  `created_at`)
- `available_payment_actions` (transicoes que o operador pode disparar agora)

Atualizacao de status:

```json
{
  "status": "sent",
  "carrier_name": "Correios",
  "tracking_code": "AB123456789BR"
}
```

Valores aceitos:

- `prepared`
- `sent`
- `delivered`
- `cancelled`

Regras de transicao:

- pedido delivery passa de `prepared` para `sent` e depois `delivered`;
- para marcar `sent`, envie `carrier_name` e `tracking_code`;
- pedido pickup pode ir de `prepared` direto para `delivered`;
- `delivered` e `cancelled` sao terminais;
- cancelar estorna estoque de checkout e PDV de forma idempotente;
- cancelar tambem liquida o pagamento: `pending`/`failed` viram `cancelled`,
  `paid` vira `refund_pending` (nunca `refunded` automatico).

Pagamento do pedido:

```json
{
  "payment_status": "paid",
  "reference": "TED 4432",
  "note": "opcional"
}
```

Exige papel de escrita e membership na loja resolvida (loja de outro tenant
retorna 404). Estados: `pending`, `paid`, `failed`, `refund_pending`,
`refunded`, `cancelled`.

- Transicoes manuais permitidas: `pending -> paid`, `pending -> failed`,
  `failed -> pending`, `refund_pending -> refunded`.
- `cancelled` e `refund_pending` nunca sao alcancaveis por esta acao — so
  pelo cancelamento do pedido.
- Idempotente: repetir o mesmo alvo nao gera segundo evento.
- Alvo ilegal a partir do estado atual → HTTP 400.
- O Bip Flow nao executa reembolso: "confirmar reembolso" registra um
  reembolso feito por fora do sistema.

Resposta: o `SaleOrderDetailSerializer` completo (badge + historico
atualizados sem reload).

Metricas (`summary`) — `revenue_total` / `orders_count` seguem sendo volume
de pedidos nao-cancelados; novos campos separam dinheiro recebido:
`paid_revenue_total`, `paid_orders_count`, `pending_payment_total`,
`pending_payment_count`, `refund_pending_total`, `refund_pending_count`. As
fatias `paid` / `pending` sao medidas sobre pedidos nao-cancelados; a fatia
`refund_pending` sobre uma base que inclui cancelados (esse estado so existe
em pedido cancelado). `breakdown.by_payment_method` ganha `paid_revenue_total`.
