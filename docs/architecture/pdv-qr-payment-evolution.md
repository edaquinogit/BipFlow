# PDV: leitura de QR, pagamento presencial e blindagem transacional

Continuação de `qrcode-stock-exit-evolution.md`,
`qrcode-stock-exit-refinement.md`, `pdv-camera-scanner-refinement.md` e
`online-sales-foundation.md`. Segue o mesmo padrão de **etapas verticais**.

Foco absoluto: o caminho crítico de uma **venda presencial** — escanear,
montar carrinho, escolher forma de pagamento, finalizar **uma única vez**,
com estoque e razão financeira consistentes sob falha, retry e concorrência.
Aparência vem depois da função.

Este ciclo **não** integra gateway, não cobra, não confirma Pix
automaticamente, não reembolsa e não faz deploy. Todo o diff é local.

## Fase A — Fluxo descoberto (arqueologia)

```text
DashboardPdvView.vue
  input de texto (HID / digitação)  --.
  PdvCameraScannerModal (qr-scanner) --+--> parseScanPayload()  (utils/pdvScan.ts)
  busca por nome/SKU (nova)          --'        |
                                               v
                                   ProductService.getByCode(code)
                                               |
                                     usePdvCart (carrinho local, agrega por código)
                                               |
                                   PdvSaleService.create({ items[], payment_method,
                                                           idempotency_key, ... })
                                               |
                                POST /v1/pdv/sales/  (bipdelivery/api/pdv.py)
                                   has_dashboard_write_access + resolve_request_store
                                   idempotência (SaleOrder.idempotency_key)
                                   StoreCommerceSettings.allows_payment_method()
                                   transaction.atomic:
                                     _reserve_stock  (SELECT ... FOR UPDATE, bulk_update)
                                     SaleOrder (channel=loja_fisica, payment_status=paid)
                                     record_initial_payment_event  (PaymentStatusEvent)
                                     SaleOrderItem.bulk_create
                                     StockMovement.bulk_create  (source=pdv, reason=venda)
```

**Papel do QR (confirmado, sem ambiguidade):** a etiqueta do produto
codifica a URL pública `{FRONTEND_BASE_URL}/l/{slug}/p/{public_code}`
(`product_labels.py`). A câmera do caixa lê essa etiqueta; o cliente com uma
câmera genérica cai na vitrine. O QR **identifica um produto** — nunca um
pagamento, um preço, uma loja ou um estado financeiro. A venda presencial
nasce `paid` porque o dinheiro trocou de mãos no balcão (decisão da
`online-sales-foundation`, preservada), **não** porque um QR foi lido.

## Fase B — Causa-raiz do QR lento / ilegível (análise estática)

Sem câmera física neste ambiente; hipóteses ordenadas por probabilidade,
todas endereçadas na Fase C:

| # | Hipótese | Correção |
| --- | --- | --- |
| 1 | Resolução de captura padrão (~640×480). Um QR que codifica uma URL de ~50 chars é versão 3–4 (29–33 módulos); impresso pequeno, não há pixels/módulo suficientes. | `applyConstraints` pedindo 1280–1920 de largura ideal + `focusMode: continuous` após `start()`. |
| 2 | Sem lanterna → falha com pouca luz. | Botão de lanterna quando `track.getCapabilities().torch` existe. |
| 3 | Espera silenciosa: nenhum feedback entre "abriu a câmera" e "leu". | Instrumentação `performance.now()` + dica "aproxime / acenda a tela / use a busca" após 6 s sem leitura. |
| 4 | `maxScansPerSecond: 5` no caminho WASM (iOS Safari, Android antigo). | Elevado para 8; `BarcodeDetector` nativo continua preferido por `qr-scanner`. |
| 5 | Sem fallback além do campo de texto. | Busca por nome/SKU/código convergindo no mesmo pipeline. |

Métricas-alvo (Fase G) e a validação em aparelho real continuam
**pendentes de dispositivo físico** — ver checklist no fim.

## Fase C — Arquitetura do leitor

Fronteiras (já parcialmente existentes, reforçadas):

1. captura + decode: `usePdvCameraScanner.ts` (câmera, permissões, torch,
   cooldown, instrumentação);
2. parsing/validação: `parseScanPayload()` — **chokepoint único** para
   câmera, HID e digitação;
3. resolução de domínio: `ProductService.getByCode` (server-side,
   store-scoped);
4. aplicação no carrinho: `usePdvCart`;
5. feedback: componente.

`parseScanPayload()` trata todo scan como entrada não confiável: teto de
512 chars, rejeita caracteres de controle / espaço / `javascript:` /
`data:` / `<` / `>`, só devolve um token no formato de `public_code` (ou o
segmento `/p/<code>` de um deep-link nosso). Nada a jusante vê uma URL crua
ou um blob arbitrário.

## Fase F — Consistência transacional e financeira

Mudanças em `bipdelivery/api/pdv.py`:

### Idempotência

- Campo opcional `idempotency_key` (`[A-Za-z0-9:_-]{8,128}`, mesmo contrato
  do checkout). O front gera **um valor por carrinho** e o reaproveita em
  todo retry.
- Reusa a infra já existente em `SaleOrder`
  (`idempotency_key` + `idempotency_payload_hash` + `UniqueConstraint`
  `unique_sale_order_idempotency_per_store`) — **sem migration nova**.
- Pré-checagem: mesma chave + **mesmo canal (`loja_fisica`)** + mesmo hash
  de payload → devolve a venda original (201, corpo reconstruído). Qualquer
  divergência (payload diferente, ou a chave já pertence a um pedido de
  outro canal) → **409 `idempotency_key_conflict`**, nada é gravado.
- Corrida real: se dois processos passam a pré-checagem, o segundo
  `INSERT` trai a `UniqueConstraint` → `IntegrityError` capturado **fora**
  do `transaction.atomic` (rollback total já ocorreu). O handler devolve o
  vencedor (se for PDV) ou um **409** (se a chave for de outro canal) —
  nunca um 500, nunca o pedido de outro canal.
- A `UniqueConstraint` é `(store, idempotency_key)` — **não** é
  channel-scoped (foi desenhada pelo checkout online, PR #21). Por isso
  `find_pdv_idempotent_order` é channel-agnóstico na busca, mas os dois
  consumidores exigem `channel == loja_fisica` **explicitamente** antes de
  tratar como replay — defesa em profundidade, não confiança na
  não-colisão de um SHA-256.
- O hash canônico inclui `store_id`, `performed_by_id`, `payment_method` e
  os itens ordenados — trocar de operador, de método ou de carrinho sob a
  mesma chave é conflito, não replay. (Campos opcionais do cliente — nome,
  telefone, e-mail, observação — **não** entram no hash: incluí-los
  transformaria um retry legítimo em 409; a contrapartida é que um retry
  ignora uma edição tardia desses campos. **LOW**, aceito.)

### Formas de pagamento — NÃO acopladas à vitrine

O PDV aceita `pix`/`card`/`cash` **incondicionalmente**, como sempre fez.
`StoreCommerceSettings.accepts_pix/card/cash` é a configuração **da vitrine
online** (docstring do modelo, aba "Vendas online", `check_go_live_readiness`,
`PublicStoreCommerceSettingsSerializer`). Um lojista que desativa "cartão"
para o checkout online **não pode** ter a maquininha recusada no balcão.
Uma configuração de pagamento específica do balcão seria uma feature de
produto separada — fora do escopo deste ciclo. `test_pdv_security` e
`PdvSalePaymentMethodTest` travam essa decisão.

### Atomicidade (inalterada, agora testada explicitamente)

Todo o bloco — reserva de estoque, `SaleOrder`, `PaymentStatusEvent`,
`SaleOrderItem`, `StockMovement` — vive num único `transaction.atomic`.
Qualquer exceção → rollback integral: nenhuma venda parcial, nenhum evento
órfão, nenhuma baixa fantasma.

### Logs estruturados e sanitizados

Eventos `pdv.sale.finalize_started | finalize_succeeded | finalize_failed |
finalize_replayed | finalize_deduplicated | idempotency_conflict`. Campos:
`store_id`, `item_count`, `payment_method`, `has_idempotency_key`,
`order_reference`, `existing_channel`, `duration_ms`. **Nunca**:
`public_code`, nome/telefone/e-mail do cliente, observações, chave crua.

## Threat model (gate de cibersegurança financeira)

Método: revisão dos ativos (venda, item, movimento de estoque, evento de
pagamento, chave de idempotência), dos atores (caixa autenticado, operador
de outra loja, atacante com token de dashboard, cliente com etiqueta
adulterada, rede instável) e dos abusos (replay, enumeração, adulteração de
preço/loja, double-submit, commit parcial, cross-tenant, injeção via QR,
vazamento em log).

| # | Requisito do gate | Controle | Severidade se violado | Teste |
| --- | --- | --- | --- | --- |
| 1 | Venda + estoque + pagamento atômicos | `transaction.atomic` único cobrindo reserva, ordem, evento, itens, movimentos | BLOCKER | `PdvSaleAtomicityTest`, `test_partial_failure_in_a_multi_item_sale_rolls_back_everything` |
| 2 | Idempotência resiste a concorrência real | `UniqueConstraint` + recuperação de `IntegrityError` fora do atomic | BLOCKER | `PdvSaleConcurrencyTest` (Postgres, 3 threads), `test_concurrent_insert_race_recovers_by_returning_the_winner` |
| 3 | Preço/total/loja/operador/estado financeiro só no backend | payload só carrega `public_code`+`quantity`+`variant_id`; preço via `get_effective_price`; loja via `resolve_request_store`; operador via `request.user`; `payment_status` fixo em `paid` no servidor | BLOCKER | `test_single_item_sale_...`, `test_cross_store_code_is_not_found`, `PdvSaleIdempotencyTest.test_the_key_is_scoped_per_store` |
| 4 | QR identifica produto, nunca comprova pagamento | pipeline do scan só resolve `public_code`; pagamento é seleção manual do caixa + confirmação explícita (dinheiro: valor recebido ≥ total; pix/cartão: toggle "recebi o pagamento") | BLOCKER | `parseScanPayload` specs; `DashboardPdvView` specs de confirmação |
| 5 | Chamada direta não burla RBAC / multi-tenant | `has_dashboard_write_access` (401/403); `_lock_products` filtra `store=store`; `find_pdv_idempotent_order` filtra `store=store` + os consumidores exigem `channel==loja_fisica` | BLOCKER | `test_pdv_security` (18 tentativas de adulteração), `PdvSaleCrossChannelIdempotencyTest`, `test_the_key_is_scoped_per_store` |
| 6 | Nenhum erro deixa venda parcial | ver #1 | BLOCKER | `PdvSaleAtomicityTest` |
| 7 | Ledger e eventos append-only | `pdv.py` só `create`/`bulk_create` em `PaymentStatusEvent` e `StockMovement`; replay não grava novo evento | HIGH | `test_replay_with_the_same_key_returns_the_original_sale` (conta eventos/movimentos == 1) |
| 8 | Sem dado real/segredo/PII/payload em logs | `log_base` só com metadados sanitizados; fixtures sintéticas | HIGH | revisão de `pdv.py`; `parseScanPayload` rejeita payload bruto antes de qualquer log |
| 9 | CSRF/CORS/auth não enfraquecidos | nenhuma mudança em auth, CSRF, CORS; endpoint continua dashboard-auth | HIGH | suíte de auth inalterada (regressão) |
| 10 | Findings classificados e ligados a testes | esta tabela | INFO | — |

### Findings

Uma revisão adversarial independente (2ª passada) reclassificou 3 achados e
os corrigiu; todos revalidados. Nenhum **BLOCKER/HIGH/MEDIUM** aberto ao fim.

Corrigidos nesta revisão:

- **HIGH (corrigido)** — 1ª passada acoplou o PDV a
  `StoreCommerceSettings.accepts_*`, que é config **online-only** →
  regressão silenciosa (maquininha recusada no balcão). **Gate removido**;
  o PDV volta a aceitar pix/card/cash sempre. Testes: `test_pdv_security`,
  `PdvSalePaymentMethodTest`.
- **MEDIUM (corrigido)** — a `UniqueConstraint (store, idempotency_key)` é
  compartilhada com o checkout; o replay do PDV dependia de um SHA-256 não
  colidir. Agora os consumidores exigem `channel==loja_fisica`
  explicitamente; colisão cross-canal → 409 limpo. Testes:
  `PdvSaleCrossChannelIdempotencyTest` (× 12 em Postgres).
- **MEDIUM (corrigido)** — `usePdvCameraScanner.start()` sem guarda de
  instância única → abrir/fechar/reabrir rápido podia deixar um stream de
  câmera órfão. Token de geração: `start()` derruba o anterior; um `start()`
  cujo `await` resolve depois de `stop()` descarta a instância. Testes novos
  em `usePdvCameraScanner.spec.ts`.
- **MEDIUM (corrigido)** — a coluna lateral `lg:sticky lg:top-6` deslizava
  **sob** o `DashboardHeader` (`sticky top-0 z-50`), escondendo o campo
  "Valor recebido"/botão Finalizar ao rolar. Corrigido para `lg:top-20` +
  `max-h`/`overflow-y-auto`. Testes: unit `DashboardPdvView.spec.ts` +
  Cypress `pdv-qr-payment.cy.ts` cenário 6.

Abertos (LOW/INFO):

- **LOW-1** — Sem throttle dedicado em `POST /v1/pdv/sales/`. Mitigação:
  sessão de dashboard + RBAC + idempotência. Follow-up: `ScopedRateThrottle`.
- **LOW-2** — Hash de idempotência ignora nome/telefone/e-mail/observação
  tardios do cliente (ver seção idempotência). Aceito.
- **LOW-3** — `payment_reference` não coletado no PDV. Follow-up de UX.
- **LOW-4** — `region de scan` com `x/y` clampados em 0 para o 1º frame
  antes do vídeo ter dimensão (corrigido, sem risco).
- **INFO-1** — `PdvSaleConcurrencyTest` só roda em Postgres; em SQLite é
  `skip`. Rodado 12× contra Postgres 16 nesta sessão: **12/12 verde**.
- **INFO-2** — Percentis de câmera em aparelho físico: aguardando os
  números do teste orientado (template devolvido em branco na 1ª tentativa).

## Fase H — Testes

Backend:

- `test_pdv_idempotency.py` — replay sem efeito colateral, conflito de
  payload → 409, sem chave = duas vendas, chave malformada → 400, corrida
  determinística (mock blind-first), escopo por loja, `PdvSaleAtomicityTest`
  (falha injetada → rollback total), `PdvSalePaymentMethodTest` (PDV ignora
  a config online), `PdvSaleCrossChannelIdempotencyTest`,
  `PdvSaleConcurrencyTest` (`TransactionTestCase`, 3 threads reais,
  skipUnless Postgres).
- `test_pdv_security.py` — 18 tentativas de adulteração direta: price/total/
  subtotal/store/performed_by/payment_status/paid_at/channel/order_reference
  no payload são ignorados; produto/variante de outra loja → 400; quantidade
  ≤ 0 / acima do estoque → 400 atômico; método desconhecido → 400; notes
  gigante → 400; chave de outra loja não vaza; viewer → 403; anon → 401;
  `get_effective_price` é a única fonte de preço.

Frontend unit: `parseScanPayload` (hardening + payloads adversariais),
`pdvChange` (troco em centavos), `idempotency`, `usePdvCameraScanner`
(torch, instrumentação sanitizada, dica de lentidão, guarda de instância
única / descarte de `start()` superado), `PdvCameraScannerModal`,
`DashboardPdvView` (chave enviada + regenerada, retry mesma chave, 409,
gate de troco, confirmação manual pix/cartão, filtro removido, busca,
payload não reconhecido, sidebar sticky limpa o header).

E2E (`bipflow-frontend/cypress/e2e/checkout/`):

- `pdv-qr-decode.cy.ts` — **decodificador real contra QR real**: pega o QR
  que `product_labels.py` gera (`GET /v1/products/{id}/qr-code/`), decodifica
  de volta com o engine do `qr-scanner` (BarcodeDetector nativo / WASM),
  round-trip exato do payload, em escala reduzida (65 %) e rotação (12°),
  rejeita imagem não-QR, e alimenta o decode no PDV real → carrinho.
- `pdv-qr-payment.cy.ts` — 10 cenários: busca manual, "decode" determinístico
  de deep-link, permissão de câmera negada + fallback, frame repetido não
  duplica, dois códigos, dinheiro + troco + bloqueio, pix exige confirmação,
  double-submit → 1 venda, falha transitória + retry → 1 venda, estoque
  baixa em 1 + resumo.

## Checklist manual obrigatório (aparelho físico) — PENDENTE

- [ ] PDV publicado em HTTPS real; autorizar câmera; confirmar traseira.
- [ ] Medir abertura e primeira leitura em 10 tentativas (luz normal).
- [ ] Testar distâncias/ângulos, pouca luz, lanterna.
- [ ] Fechar/reabrir o scanner; alternar app/aba (câmera some e volta).
- [ ] Negar permissão → fallback de busca funciona.
- [ ] Ler o mesmo código repetidamente → cooldown impede duplicar item.
- [ ] Finalizar uma venda de teste em ambiente local/seguro → **uma**
      venda, **uma** baixa, pagamento correto.
- [ ] Double-tap / Enter preso no "Finalizar" → **uma** venda.
- [ ] Derrubar a rede no meio do finalize → retry devolve a mesma venda.

## Limitações

- O Bip Flow **não** processa pagamento. Pix/cartão no PDV são confirmação
  manual do caixa; a venda nasce `paid` porque o operador confirmou o
  recebimento, não por leitura de QR.
- Sem gateway, webhook, TEF, NFC-e, split, venda offline ou conciliação.
- Percentis de desempenho da câmera e aceite em aparelho: fora do que este
  ambiente consegue provar.
