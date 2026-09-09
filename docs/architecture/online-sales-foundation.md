# Online Sales Foundation

Primeira fundação comercial do **Bip Flow** para vendas online. Dá a cada
loja controle sobre **se** aceita pedidos, **como** entrega, **quais**
pagamentos aceita e o **pedido mínimo**; move a autoridade dessas regras
para o backend no checkout; e adiciona um **ciclo de vida de pagamento** ao
pedido para distinguir "pedido criado" de "dinheiro recebido".

Este ciclo **não** integra gateway, PIX automático, webhook, frete,
etiqueta ou NFC-e. Nenhum botão simula pagamento ou reembolso. O fluxo
WhatsApp continua igual; pedidos virtuais nascem com pagamento pendente.

## Estado anterior

- `Store` já era a raiz multi-tenant; `MerchantProfile` /
  `StorefrontAppearance` / `LabelSettings` já usavam o padrão
  `OneToOneField(Store)` + `get_for_store()`.
- O checkout (`CheckoutWhatsAppView`) já recalculava subtotal/frete/total no
  servidor, travava estoque, tinha idempotência e escopo por loja — mas não
  havia como uma loja pausar pedidos, restringir modalidade/pagamento ou
  exigir mínimo.
- `SaleOrder.payment_method` guardava só a **forma escolhida**. Não havia
  como saber se o pagamento chegou. As métricas do dashboard tratavam todo
  pedido não-cancelado como receita.
- O PDV (`bipdelivery/api/pdv.py`) criava `SaleOrder` presencial; o
  cancelamento (`apply_order_cancellation`) já repunha estoque de forma
  idempotente e canal-agnóstica.

## Decisões

- **`StoreCommerceSettings`** — novo `OneToOneField(Store)`, mesmo padrão de
  `MerchantProfile`. Não são colunas novas em `Store`, não reusa o singleton
  global `StoreSettings`. Flags são colunas booleanas reais (conjunto
  fechado que o checkout, o go-live e a vitrine leem por nome), nunca JSON.
- **`payment_status` em `SaleOrder`** — coluna denormalizada + tabela-razão
  append-only `PaymentStatusEvent` (mesma ideia de `StockMovement` para
  estoque). Códigos internos em inglês, rótulos de UI em português.
- **Máquina de estados em `bipdelivery/api/payments.py`** — fonte única das
  transições. Views, serializers, PDV e cancelamento chamam esse módulo.
- Métricas ganham campos `paid_*` / `pending_*` / `refund_pending_*` **sem**
  mudar o significado dos campos existentes (`revenue_total` continua sendo
  volume de pedidos não-cancelados).

## Configuração comercial

### `StoreCommerceSettings`

| Campo | Tipo | Default | Papel |
| --- | --- | --- | --- |
| `orders_enabled` | bool | `True` | loja aceita novos pedidos |
| `delivery_enabled` | bool | `True` | oferece entrega |
| `pickup_enabled` | bool | `True` | oferece retirada |
| `minimum_order_value` | decimal(10,2) | `0.00` | mínimo de produtos antes do frete |
| `accepts_pix` | bool | `True` | aceita Pix |
| `accepts_card` | bool | `True` | aceita cartão |
| `accepts_cash` | bool | `True` | aceita dinheiro |
| `created_at` / `updated_at` | datetime | — | auditoria |

Os defaults **reproduzem o comportamento anterior**: pedidos ligados,
entrega e retirada ligadas, sem mínimo, os três pagamentos aceitos.

### Invariantes

1. `minimum_order_value` nunca negativo.
2. Se `orders_enabled=True`, ao menos uma modalidade de entrega.
3. Se `orders_enabled=True`, ao menos uma forma de pagamento.

As três são `CheckConstraint` no banco (compatíveis com SQLite e
PostgreSQL) **e** re-checadas em `Model.clean()` / no serializer (HTTP 400
com chave de campo amigável). Uma loja **fechada** pode ter tudo desligado.

### Criação

- **Onboarding** (`Store.create_for_owner`) materializa a linha com os
  defaults — nova loja aceita pedidos sem passo manual.
- **`get_for_store(store)`** cria sob demanda na primeira leitura (lojas
  antigas / caminhos que não passam pelo onboarding).
- A **migration `0050`** faz backfill: uma linha default por `Store`
  existente.

## Checkout — autoridade do backend

`CheckoutWhatsAppView` valida, **antes** de criar `SaleOrder`,
`SaleOrderItem`, mexer em estoque, criar `StockMovement` ou consumir chave
de idempotência:

1. loja ativa e `orders_enabled=True` → `store_not_accepting_orders`;
2. modalidade escolhida habilitada → `delivery_method_unavailable`;
3. forma de pagamento habilitada → `payment_method_unavailable`;
4. região de entrega ativa e da mesma loja (quando delivery) →
   `delivery_region_unavailable`;
5. subtotal **recalculado no servidor** ≥ `minimum_order_value` →
   `minimum_order_not_reached`.

Todos os códigos retornam **HTTP 422** com corpo `{"code", "detail"}`. As
checagens 1–4 rodam fora da transação; a 5 roda dentro de
`_reserve_cart_stock`, depois da normalização e **antes** do decremento, de
modo que uma rejeição faz rollback limpo. A checagem roda **depois** do
short-circuit de replay idempotente: um retry de um pedido que já existe
ainda devolve o pedido, mesmo que a loja tenha fechado nesse meio-tempo.

O front (vitrine) só filtra as opções e mostra avisos — o backend continua
a autoridade. Guest checkout, perfil opcional, carrinho por loja,
idempotência, throttling e redirecionamento WhatsApp seguem intactos.

## Ciclo de vida de pagamento

### Estados

`pending` · `paid` · `failed` · `refund_pending` · `refunded` · `cancelled`

Campos novos em `SaleOrder`: `payment_status` (indexado, default `pending`),
`paid_at`, `refunded_at`, `payment_reference` (opcional, ≤ 64, texto do
operador — nunca número de cartão nem token). **Nada** de payload de
provedor, segredo de webhook ou dado bancário sensível é armazenado.

### Máquina de estados (`bipdelivery/api/payments.py`)

```text
pending  -> paid | failed | cancelled
failed   -> pending | cancelled
paid     -> refund_pending
refund_pending -> refunded
refunded -> (terminal)
cancelled -> (terminal)
```

`transition_payment(order, to_status=..., source=..., ...)`:

- re-trava a linha (`select_for_update`) dentro de `transaction.atomic`;
- **idempotente**: se já está em `to_status`, é no-op (sem evento, sem erro);
- transição indefinida → `PaymentTransitionError`, banco intocado;
- em sucesso grava **um** `PaymentStatusEvent` na mesma transação e
  atualiza `paid_at` / `refunded_at` / `payment_reference` conforme o caso.

`MANUAL_OPERATOR_TARGETS` é o subconjunto de transições que um operador pode
disparar manualmente: `pending→paid`, `pending→failed`, `failed→pending`,
`refund_pending→refunded`. `cancelled` e `refund_pending` **nunca** são
alcançáveis por botão — só pelo cancelamento do pedido.

### Defaults por canal

- **Virtual / WhatsApp** — nasce `pending` (não gera evento; o "nascimento"
  no default não é uma transição).
- **PDV** — venda presencial concluída → nasce `paid`, com `paid_at` e um
  `PaymentStatusEvent` `system` (`record_initial_payment_event`).

### Migração de dados (`0051`)

- Pedidos históricos cancelados → pagamento `cancelled`.
- Demais pedidos históricos → `pending` (nunca declara pago sem evidência,
  nunca inventa `paid_at`).
- Aditiva, determinística, reversível, segura em SQLite e PostgreSQL.

## Auditoria — `PaymentStatusEvent`

Append-only. Cada linha: `store` (denormalizado, sempre igual ao do
`order`), `order`, `previous_status`, `new_status`, `source`
(`system` | `manual` | `gateway` — o último reservado para o futuro,
ninguém escreve nesse valor neste ciclo), `performed_by` (quando humano),
`reference`, `note`, `created_at`.

- Sempre criada na **mesma transação** da mudança de status.
- Nunca alterada/apagada pela API comum (admin é read-only).
- Consultada só pelo detalhe autenticado do pedido
  (`payment_status_events` em `SaleOrderDetailSerializer`). Sem endpoint
  público.

## Integração com estoque / cancelamento

`apply_order_cancellation` (chokepoint único de cancelamento) chama
`settle_payment_for_cancelled_order` **dentro** da sua transação, depois de
marcar `status=cancelled` e repor o estoque:

- pagamento `pending` ou `failed` → `cancelled`;
- pagamento `paid` → `refund_pending` (nunca `refunded` automático — o Bip
  Flow não executa reembolso);
- `refund_pending` / `refunded` / já `cancelled` → intocado.

A idempotência existente da reposição de estoque é preservada: cancelar de
novo é no-op, não repõe duas vezes nem gera segundo evento.

## Endpoint operacional de pagamento

`PATCH /api/v1/sales-orders/{id}/payment/` — action de detail no
`SaleOrderViewSet`, mesmo padrão de `update_status`. Body:
`{"payment_status", "reference"?, "note"?}`.

- Autenticação obrigatória + `has_dashboard_write_access` + membership na
  loja resolvida. Loja de outro tenant → 404.
- Alvo validado contra `available_manual_targets(order)`; alvo ilegal → 400.
- Devolve o `SaleOrderDetailSerializer` completo (badge + histórico
  atualizados sem reload).
- O botão de reembolso diz **"Confirmar reembolso realizado"** — confirma um
  reembolso feito por fora, nunca executa um.

## Métricas financeiras

`SaleOrderViewSet.summary` mantém `revenue_total` / `orders_count` como
**volume** de pedidos não-cancelados (compatibilidade de contrato) e
adiciona:

| Campo | Significado | Base |
| --- | --- | --- |
| `paid_revenue_total` / `paid_orders_count` | só `payment_status=paid` | pedidos não-cancelados na janela |
| `pending_payment_total` / `pending_payment_count` | só `pending` | pedidos não-cancelados na janela |
| `refund_pending_total` / `refund_pending_count` | só `refund_pending` | pedidos na janela **incluindo cancelados** |

`refund_pending` só existe em pedido cancelado (a transição
`paid → refund_pending` acontece durante o cancelamento), então é medido
sobre uma base que mantém os cancelados — as demais fatias usam a base
não-cancelada de sempre.

`breakdown.by_payment_method` ganha `paid_revenue_total` (fatia de dinheiro
confirmado por método). Pedidos cancelados e reembolsados **não** entram em
receita confirmada. Na vitrine do dashboard o card principal deixa de se
chamar "Receita de vendas" (mostrava volume) e passa a "Vendas (30 dias)"
com um subtítulo que separa dinheiro recebido / pendente / a reembolsar.

## Contratos de API

Ver `docs/api/reference.md` para a tabela completa. Resumo:

| Método | Rota | Auth | Escopo |
| --- | --- | --- | --- |
| GET/PATCH | `/api/v1/store/current/commerce-settings/` | dashboard | loja resolvida (JWT/header) |
| GET | `/api/v1/public/stores/{slug}/commerce-settings/` | pública | loja do slug (ativa) |
| PATCH | `/api/v1/sales-orders/{id}/payment/` | dashboard write | loja resolvida |

## Segurança

- Toda leitura/escrita escopada pela loja resolvida
  (`resolve_request_store`); `store_id` do payload é ignorado.
- Escrita da config comercial: só `owner`/`manager` (ou staff). `viewer` lê.
- Mudança financeira sempre em `transaction.atomic` + `select_for_update`.
- Nenhum dado de instrumento de pagamento é armazenado.
- Nenhum gateway fictício, nenhum botão que aparente mover dinheiro.

## Migrations / backfill

| Migration | Conteúdo |
| --- | --- |
| `0050_store_commerce_settings` | cria `StoreCommerceSettings` + `CheckConstraint`s + RunPython: uma linha default por `Store` |
| `0051_saleorder_payment_lifecycle` | adiciona `payment_status`/`paid_at`/`refunded_at`/`payment_reference` + cria `PaymentStatusEvent` + RunPython: cancelados → `cancelled`, resto → `pending` |

Ambas verificadas em banco novo e sobre dados preexistentes (forward,
reverse, forward de novo).

## Limitações atuais

- Pagamento é movido por operador (ou pelas duas transições automáticas —
  PDV e cancelamento). O Bip Flow **não** cobra, não confirma
  automaticamente e não reembolsa.
- Sem expiração de "pagamento pendente": um pedido virtual fica `pending`
  até um humano agir.
- Sem região de entrega dinâmica / cálculo de frete real (inalterado).

## Próximos ciclos (não implementados agora)

1. Escolha do **gateway de pagamento** (Mercado Pago / Stripe / Pagar.me…).
2. **Payment Intent** + checkout online (cobrança dentro do produto).
3. **Webhook** assinado e idempotente do provedor → transição `system`.
4. Expiração de cobrança / reserva de estoque com TTL.
5. Integração de **frete** e geração de **etiqueta** (Correios / Melhor
   Envio).
6. **Fundação fiscal** (`StoreFiscalProfile`, ver
   `pedidos-nf-envio-evolution.md`).
7. **NFC-e** via provedor.

A documentação não afirma que o Bip Flow processa pagamento, reembolsa,
emite etiqueta ou NFC-e — porque não faz.
