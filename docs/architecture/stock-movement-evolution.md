# Evolução de Gestão de Estoque (Entrada/Saída)

Este documento descreve a estratégia para evoluir o controle de estoque do
Bip Flow de um campo livremente editável (`Product.stock_quantity`,
sem motivo ou histórico) para um controle de estoque com auditoria completa
(entrada/saída com motivo, vinculado a quem fez a alteração). Segue o mesmo
padrão de **etapas verticais** do `docs/architecture/multi-tenant-evolution.md`:
cada etapa entrega backend + frontend juntos, testado, sem quebrar o que já
funciona.

## 1. Diagnóstico do estado anterior

Antes da Etapa 1, `Product.stock_quantity` era alterado em exatamente dois
lugares, nenhum deles auditado:

| Caminho | Situação anterior | Problema |
| --- | --- | --- |
| PATCH do dashboard (`ProductSerializer`) | Campo livre, qualquer usuário com permissão de escrita podia sobrescrever o número | Sem motivo, sem histórico, sem saber quem alterou |
| Checkout (`CheckoutWhatsAppView._reserve_cart_stock`) | Decremento automático via `bulk_update`, dentro de `transaction.atomic()` + `select_for_update()` | Decremento correto, mas sem deixar rastro algum |

Não existia nenhum modelo de auditoria (`StockMovement`/`InventoryLog`)
nem flags de controle (`track_stock`/`unlimited_stock`).

## 2. Decisão arquitetural

`stock_quantity` continua sendo a coluna rápida e desnormalizada ("valor
atual"), lida em todo lugar que já a lê hoje (filtros de catálogo, bot,
checkout). Uma nova tabela `StockMovement` é o **ledger** que explica cada
mudança nesse valor — análogo a um Kardex. A partir da Etapa 1:

- Toda alteração manual passa por um único chokepoint
  (`bipdelivery/api/stock.py:apply_stock_movement`) que tranca a linha do
  produto, valida, atualiza `stock_quantity`/`is_available` e cria o
  `StockMovement` na mesma transação.
- O decremento do checkout continua otimizado (1 `bulk_update` para N
  produtos, sem lock por item) — mas passa a gerar os `StockMovement`
  correspondentes via `bulk_create`, montados a partir de dados já em
  memória (sem query extra por produto).
- O campo de estoque do formulário do dashboard fica editável **somente na
  criação** do produto; depois disso, toda alteração exige passar pela tela
  de entrada/saída.

## 3. Etapa 1 — Fundação: movimentação manual + log automático de venda ✅ (concluída)

Backend:

- Modelo `StockMovement` (`bipdelivery/api/models.py`): `store`, `product`,
  `movement_type` (entrada/saída), `quantity` (sempre positivo — a direção
  vem do tipo, não de sinal), `previous_stock`/`new_stock` (snapshot),
  `reason` (compra/devolução/perda_avaria/ajuste_inventario/
  entrada_inicial/venda/outro — os dois últimos só gerados pelo sistema),
  `source` (manual/venda), `sale_order` (FK nullable), `performed_by` (FK
  nullable), `notes`. Migration `0021_stock_movement.py`.
- Helper único `apply_stock_movement()` (`bipdelivery/api/stock.py`) para
  mutações manuais — usado pelo endpoint de entrada/saída.
- `ProductViewSet.stock_movements` (`@action` em
  `bipdelivery/api/views.py`): `GET /v1/products/{id}/stock-movements/`
  (histórico paginado, exige `has_dashboard_read_access`) e
  `POST /v1/products/{id}/stock-movements/` (registra entrada/saída
  manual, exige `has_dashboard_write_access`).
- `ProductViewSet.perform_update` rejeita PATCH que inclua
  `stock_quantity` (400, mensagem orientando a usar a movimentação).
  `ProductViewSet.perform_create` registra automaticamente uma
  movimentação `entrada_inicial` quando o produto nasce com estoque > 0.
- `CheckoutWhatsAppView` passou a `bulk_create` um `StockMovement`
  (`source=venda`, `reason=venda`, vinculado ao `SaleOrder`) por produto do
  carrinho, sem custo de query adicional por item.
- **Sem backfill** de `entrada_inicial` para produtos criados antes desta
  etapa — fabricar uma movimentação histórica com a data da migration seria
  uma auditoria enganosa. Esses produtos mostram o estoque atual sem uma
  entrada que o explique, até a próxima movimentação real.

Frontend:

- `ValuationSection.vue` trava o campo "Estoque" (`disabled`) quando
  `isExistingProduct` é verdadeiro; mensagem orienta a usar a nova ação.
  `ProductFormRoot.vue` repassa essa prop a partir de `!!props.initialData`.
- Nova ação "Movimentar estoque" na tabela de produtos: `TableRow.vue` →
  `ProductTableRoot.vue` → `ProductListing.vue` → `DashboardProductsView.vue`
  (emit `adjust-stock` propagado em cada nível, mesmo padrão de
  `edit`/`delete`).
- Novo `StockMovementModal.vue` (toggle entrada/saída, motivo, quantidade,
  observação opcional, preview do novo estoque antes de confirmar).
- `useProducts.ts.adjustStock()` chama `ProductService.createStockMovement`
  e sincroniza o produto retornado em `products.value`, mantendo
  `outOfStockProducts`/`lowStockProducts`/`inventoryStats` reativos sem
  mudança nesses computeds.
- Novo `types/stockMovement.ts` (Zod schema + tipos, mesmo padrão de
  `types/product.ts`).

Testes: `bipdelivery/tests/test_stock_movements.py` (entrada/saída manual,
rejeição de saída maior que o estoque, isolamento entre lojas, permissões
por papel, `entrada_inicial` na criação, bloqueio do PATCH direto) +
extensão de `CheckoutWhatsAppAPITest` (`test_api_health.py`) confirmando o
`StockMovement` gerado pela venda. Frontend:
`StockMovementModal.spec.ts`, extensão de `useProducts.spec.ts` e
`ProductListing.spec.ts` (propagação do `adjust-stock`), extensão de
`ValuationSection.spec.ts` (campo travado/destravado). 298 testes backend
(pytest) + 163 testes frontend (vitest) verdes, mais `typecheck`/`lint`
limpos.

**Visível para o usuário final:** sim (ação nova na tabela de produtos).
**Risco:** baixo — aditivo, não removeu nenhuma capacidade, só trocou o
caminho de edição direta por um caminho auditado.

## 4. Etapa 2 — Ledger completo da loja ✅ (concluída)

Backend: `StockMovementViewSet` (`bipdelivery/api/views.py`, registrado em
`v1_urls.py` como `router.register(r"stock-movements", ...)`) — somente
leitura (`ReadOnlyModelViewSet`; criar uma movimentação continua exclusivo
de `ProductViewSet.stock_movements`, que é quem trava a linha do produto).
Filtros via `get_base_queryset()`: `product`, `movement_type`, `source`,
`reason`, `search` (nome/SKU do produto) e `start`/`end` (reaproveita
`_resolve_custom_range()`, o mesmo resolvedor de intervalo já usado por
`SaleOrderViewSet.summary`/`breakdown`/`customers`). Permissão
`IsDashboardReadRole` (dado de dashboard, não público — diferente do
list/retrieve de produto). `StockMovementSerializer` ganhou `product_name`/
`product_sku` (com `select_related("product", ...)` para não criar N+1) —
usado tanto pelo histórico por produto (Etapa 1) quanto por este ledger.

Frontend: nova rota `dashboard/produtos/movimentacoes`
(`DashboardRoutes.StockMovements`) com `DashboardStockMovementsView.vue` —
filtros (produto, tipo, origem, motivo, intervalo de datas, busca),
tabela paginada e exportação CSV reaproveitando
`bipflow-frontend/src/utils/csv.ts` (`downloadCsv`, já usado pela seção de
analytics de vendas). Novo `services/stockMovement.service.ts` +
`composables/useStockMovements.ts` (deliberadamente **não** singleton —
diferente de `useProducts`/`useCategories`, o estado de filtro/paginação
pertence só a essa view). Botão "Histórico de estoque" adicionado ao
cabeçalho de `ProductListing.vue`, ao lado de "Novo produto", como ponto de
entrada — a navegação principal (`DashboardHeader.vue`) não foi alterada.

**Bug real encontrado na verificação ao vivo (antes dos testes
automatizados):** o histórico por produto (`ProductViewSet.stock_movements`,
Etapa 1) estava paginando com `ProductListPagination` (`page_size=12`, hoje
da grade de 3x4 da vitrine) em vez de `StandardPagination` (`page_size=20`)
como o plano original previa — `self.paginate_queryset()` lê
`self.pagination_class`, que a action nunca sobrescrevia, então herdava o
valor de classe do `ProductViewSet`. Corrigido sobrescrevendo
`self.pagination_class = StandardPagination` antes de paginar, dentro do
branch `GET` da action. Achado via smoke test `curl` contra o servidor de
desenvolvimento real, não pelos testes automatizados (nenhum teste
verificava `page_size` explicitamente) — reforça o valor de rodar o
servidor de verdade antes de considerar uma etapa pronta.

Testes: extensão de `bipdelivery/tests/test_stock_movements.py`
(`StockMovementLedgerAPITest` — isolamento entre lojas, todos os filtros,
busca, intervalo de datas, papéis de permissão, `405` ao tentar `POST`).
Frontend: `useStockMovements.spec.ts`, `DashboardStockMovementsView.spec.ts`.
310 testes backend (pytest) + 176 testes frontend (vitest) verdes, mais
`typecheck`/`lint` limpos.

**Visível para o usuário final:** sim (nova página + botão de acesso).
**Risco:** baixo — leitura aditiva sobre dados que a Etapa 1 já popula
corretamente.

## 5. Etapa 3 — Limite de estoque baixo configurável por produto ✅ (concluída)

Backend: `Product.low_stock_threshold` (`PositiveIntegerField`, `null=True,
blank=True`, migration `0022_product_low_stock_threshold.py`), exposto em
`ProductSerializer.Meta.fields` — **não** está em `read_only_fields`, então
fica gravável tanto na criação quanto via PATCH/PUT, sem nenhum conflito com
o bloqueio de `stock_quantity` (`perform_update` só verifica a presença
literal de `"stock_quantity"` no body). `null` significa "usar o padrão do
painel"; um valor explícito `0` é uma escolha válida e diferente ("só
alertar quando zerar de verdade").

Frontend: novo `utils/stockAlerts.ts` — `DEFAULT_LOW_STOCK_THRESHOLD` (5,
mesmo valor que o antigo fixo), `getLowStockThreshold(product)`,
`isOutOfStock(product)`, `isLowStock(product)`. `useProducts.ts`'s
`outOfStockProducts`/`lowStockProducts` passaram a usar esses helpers em vez
do antigo `LOW_STOCK_THRESHOLD = 5` hardcoded. **Achado durante a
implementação:** `TableRow.vue` tinha o **mesmo** "5" duplicado e
independente (cor do badge de estoque na tabela) — corrigido para usar o
mesmo `getLowStockThreshold()`, fora do escopo original do texto desta
etapa mas claramente o mesmo conceito duplicado na mesma tela; deixados de
lado, intencionalmente, dois outros "5" hardcoded encontrados na vitrine
pública (`views/products/ProductCard.vue`, `ProductDetailView.vue`, badge
"Últimas unidades") — são mensagens para o cliente final, não alertas
internos do painel, e mudar esse comportamento visível à loja pública é uma
decisão de produto que não foi pedida nesta etapa.

Novo campo "Limite de estoque baixo" em `ValuationSection.vue`, **sempre**
editável (diferente do campo de estoque, que só é editável na criação) —
normalizador próprio (`normalizeLowStockThresholdModel`) garante que limpar
o campo resulte em `null`, nunca em `0` (são escolhas diferentes). Em
`useProducts.ts`'s `_preparePayload()`, esse campo precisou de um branch
próprio *antes* do guard genérico de campos vazios: todo outro campo
`null`/`""`/`undefined` é omitido do `FormData` (significa "não tocar"),
mas aqui `null` precisa virar uma string vazia explícita para o backend de
fato limpar o valor — confirmado batendo no servidor de desenvolvimento
real via `curl -F "low_stock_threshold="` antes de escrever o código (DRF já
mapeia `''` → `None` para campos nullable em form/multipart, sem precisar
de nenhuma mudança no backend).

Testes: extensão de `ProductAPIHealthTest` (`test_api_health.py`) — default
nulo, criação com valor, edição via PATCH sem conflito com o lock de
`stock_quantity`, limpar de volta para `null`, rejeição de valor negativo.
Frontend: novo `utils/__tests__/stockAlerts.spec.ts`, extensão de
`useProducts.spec.ts` (override por produto + payload do FormData),
`ValuationSection.spec.ts` (null vs. zero, sempre editável) e novo
`TableRow.spec.ts` (cor do badge por limite customizado). 315 testes
backend (pytest) + 195 testes frontend (vitest) verdes, mais
`typecheck`/`lint` limpos. Verificado de ponta a ponta contra o servidor de
desenvolvimento real (criar → definir limite → limpar → redefinir como 0).

**Visível para o usuário final:** sim. **Risco:** baixo.

## 6. Etapa 4 — Unificar o limite com a vitrine pública ✅ (concluída)

A Etapa 3 deixou uma divergência registrada como nota de risco: o badge
"Últimas unidades"/"X restantes" da vitrine pública (`ProductCard.vue`,
`ProductDetailView.vue`) continuava com um `<= 5` fixo, independente do
`low_stock_threshold` que o painel já deixava configurável por produto.
Esta etapa fecha essa divergência.

Backend: **nenhuma mudança** — `ProductSerializer` já expunha
`low_stock_threshold` publicamente desde a Etapa 3 (é o mesmo serializer
usado pelo `list`/`retrieve` público e pelo dashboard); confirmado batendo
em `GET /v1/products/` sem autenticação contra o servidor real antes de
escrever qualquer código.

Frontend: `utils/stockAlerts.ts` deixou de depender do `Product` do schema
administrativo (`schemas/product.schema.ts`) e passou a aceitar um tipo
estrutural mínimo (`StockAlertable` — só `stock_quantity`, `is_available`,
`low_stock_threshold?`), porque o `Product` da vitrine pública
(`types/product.ts`) é um tipo *diferente e incompatível* em outros campos
(`price` é `string` na vitrine, `number` no admin). Isso tornou o mesmo
helper (`isLowStock`) reutilizável dos dois lados sem duplicar a lógica.
`low_stock_threshold` foi adicionado ao `Product`/`ProductSchema` de
`types/product.ts`. `ProductCard.vue` e `ProductDetailView.vue` trocaram o
`stock_quantity <= 5` fixo por `isLowStock(product)`.

Testes: extensão de `ProductCard.spec.ts` (rótulo "X restantes" no limite
padrão e em um `low_stock_threshold` customizado) e novo bloco em
`stockAlerts.spec.ts` provando que um objeto no formato exato da vitrine
(sem nenhum campo exclusivo do admin) classifica igual. Não foi criado um
harness de teste novo para `ProductDetailView.vue` (791 linhas, várias
dependências de rota/serviços) para uma troca de uma linha que já reusa uma
função exaustivamente testada — desproporcional ao risco. 315 testes
backend (pytest, inalterados) + 200 testes frontend (vitest) verdes, mais
`typecheck`/`lint` limpos. Verificado contra o servidor de desenvolvimento
real (HMR sem erros, endpoint público confirmado).

**Visível para o usuário final:** sim (mensagem da vitrine pública agora
reflete o limite configurado pelo lojista). **Risco:** baixo — leitura
aditiva, nenhuma mudança de contrato de API.

## 7. Etapa 5 -- Ledger de estoque das variantes via formulario ✅ (concluida)

Depois da introducao de variantes, `ProductVariant.stock_quantity` virou a
fonte de verdade para produtos com variantes ativas. O formulario de produto
ja sincronizava o agregado (`Product.stock_quantity`) a partir dessas
variantes, mas uma edicao direta do numero da variante nao deixava rastro no
`StockMovement`.

Decisao: alteracoes de estoque feitas via `variants_payload` tambem geram
ledger.

Backend:

- `ProductSerializer._sync_variants()` registra `StockMovement` com
  `variant_id` quando o estoque de uma variante muda.
- Criacao de produto com variantes estocadas gera uma `entrada_inicial` por
  variante, nao uma entrada agregada no produto.
- Edicao posterior de estoque da variante gera `ajuste_inventario`, com
  direcao derivada do delta: aumento vira `entrada`; reducao vira `saida`.
- Atualizacao apenas de metadados da variante (nome, cor, imagem, posicao)
  nao cria movimento.
- `performed_by` vem do `request.user` do dashboard.

Testes: extensao de `ProductAPIHealthTest` cobrindo criacao inicial por
variante, aumento, reducao e payload legado sem `stock_quantity`.

**Visivel para o usuario final:** indiretamente, pelo historico de estoque
mais fiel. **Risco:** baixo -- mantem o formulario atual, mas torna a
mutacao auditavel.

## 8. Riscos e pontos de atenção

| Risco | Onde aparece | Mitigação |
| --- | --- | --- |
| Resubmit do formulário de edição reenviar `stock_quantity` antigo e disparar a rejeição 400 | Etapa 1 | `DashboardProductsView.handleSave` remove `stock_quantity` do payload de update antes de chamar `updateProduct` — a rejeição do backend é defesa contra chamadas diretas à API, não o caminho esperado pela UI |
| Checkout (hot path) ganhar uma query extra por produto ao auditar a venda | Etapa 1 | `StockMovement.objects.bulk_create()` único, montado de dados já em memória — sem `select_for_update()` por item |
| Ledger incompleto para produtos criados antes da Etapa 1 | Etapa 1 | Decisão deliberada de não fabricar histórico — documentado aqui como limitação conhecida |
| `StockMovementCreateSerializer` aceitar motivos exclusivos do sistema (`entrada_inicial`, `venda`) vindos do formulário manual | Etapa 1 | `validate_reason` rejeita explicitamente `StockMovement.SYSTEM_ONLY_REASONS` |
| Action `@action` herdar silenciosamente o `pagination_class` da classe em vez do esperado para aquela rota específica | Etapa 2 | Sobrescrever `self.pagination_class` explicitamente antes de `self.paginate_queryset()`; nenhum teste automatizado checava `page_size`, só o smoke test ao vivo pegou — vale considerar uma asserção de `page_size` nos testes de paginação customizada no futuro |
| `low_stock_threshold` nulo virar `0` ao limpar o campo, ou ficar "preso" no valor antigo ao tentar limpar via FormData | Etapa 3 | Normalizador dedicado no formulário (`null`, nunca `0`, para "sem override") + branch próprio em `_preparePayload()` que envia string vazia explícita para esse campo especificamente, em vez de omitir a chave como todo outro campo nulo — confirmado contra o servidor real antes de implementar |
| ~~Dois "5" hardcoded equivalentes na vitrine pública continuavam fixos, divergindo do limite configurável do painel~~ | Etapa 3 → resolvido na Etapa 4 | `ProductCard.vue`/`ProductDetailView.vue` agora usam `isLowStock()` do mesmo `utils/stockAlerts.ts` |
| `utils/stockAlerts.ts` acoplado ao tipo `Product` do schema administrativo, incompatível com o `Product` da vitrine pública (`price` string vs. number) | Etapa 4 | Tipo estrutural mínimo (`StockAlertable`) em vez de importar o `Product` de um schema específico — funciona para os dois lados sem duplicar lógica |
| Exclusao de variante com estoque ainda precisa de uma regra explicita | Etapa 5 | Edicoes numericas de estoque agora sao auditadas; excluir uma variante estocada e outro ciclo de vida, porque o FK `StockMovement.variant` e nullable e seria limpo apos a exclusao |

## 9. Definição de pronto

### Etapa 1

- [x] Modelo `StockMovement` + migration `0021_stock_movement.py`.
- [x] Helper único `apply_stock_movement()` para mutações manuais.
- [x] Endpoint `GET`/`POST /v1/products/{id}/stock-movements/`.
- [x] `perform_update` bloqueia PATCH com `stock_quantity`; `perform_create`
      registra a `entrada_inicial`.
- [x] Checkout audita a venda via `bulk_create`, sem custo extra de query
      por item.
- [x] Campo "Estoque" travado na edição do formulário do dashboard.
- [x] Nova ação "Movimentar estoque" na tabela de produtos, com modal
      dedicado.
- [x] Testes backend (`test_stock_movements.py` + extensão do checkout) e
      frontend (`StockMovementModal`, `useProducts`, `ProductListing`,
      `ValuationSection`) verdes.

### Etapa 2

- [x] `StockMovementViewSet` (somente leitura) + rota `v1/stock-movements/`.
- [x] Filtros por produto/tipo/origem/motivo/busca/intervalo de datas.
- [x] `DashboardStockMovementsView.vue` + rota
      `dashboard/produtos/movimentacoes` + ponto de entrada em
      `ProductListing.vue`.
- [x] Export CSV reaproveitando `utils/csv.ts`.
- [x] Verificado contra o servidor de desenvolvimento real (não só testes) —
      encontrou e corrigiu o bug de paginação descrito acima.
- [x] Testes backend (`StockMovementLedgerAPITest`) e frontend
      (`useStockMovements`, `DashboardStockMovementsView`) verdes.

### Etapa 3

- [x] `Product.low_stock_threshold` + migration
      `0022_product_low_stock_threshold.py`, gravável a qualquer momento
      (sem conflito com o lock de `stock_quantity`).
- [x] `utils/stockAlerts.ts` como fonte única do cálculo de limite/baixo
      estoque, usado por `useProducts.ts` **e** `TableRow.vue` (achado e
      corrigido o mesmo "5" duplicado entre os dois).
- [x] Campo "Limite de estoque baixo" sempre editável em
      `ValuationSection.vue`, com `null` (não `0`) ao limpar.
- [x] `_preparePayload()` envia string vazia explícita para esse campo ao
      limpar, em vez de omitir a chave — verificado contra o servidor real.
- [x] Testes backend (extensão de `ProductAPIHealthTest`) e frontend
      (`stockAlerts`, `useProducts`, `ValuationSection`, `TableRow`) verdes.
- [x] Verificado de ponta a ponta contra o servidor de desenvolvimento real
      (criar → definir → limpar → redefinir como 0).

### Etapa 4

- [x] `utils/stockAlerts.ts` generalizado para o tipo estrutural
      `StockAlertable`, sem depender do `Product` administrativo.
- [x] `low_stock_threshold` adicionado ao `Product`/`ProductSchema` de
      `types/product.ts` (vitrine pública).
- [x] `ProductCard.vue` e `ProductDetailView.vue` usando `isLowStock()` em
      vez do `<= 5` fixo.
- [x] Confirmado que o backend já expunha o campo publicamente desde a
      Etapa 3 — nenhuma mudança de backend nesta etapa.
- [x] Testes backend (suíte completa, inalterada) e frontend
      (`ProductCard`, `stockAlerts`) verdes.
- [x] Verificado contra o servidor de desenvolvimento real.

### Etapa 5

- [x] Criacao de produto com variantes estocadas cria movimentos iniciais por
      variante.
- [x] Edicao de estoque de variante cria movimento de ajuste com `variant_id`.
- [x] Aumento usa `entrada`; reducao usa `saida`.
- [x] Payload legado sem `stock_quantity` preserva estoque e nao cria
      movimento.
- [x] Produto agregado continua sincronizado a partir das variantes ativas.
