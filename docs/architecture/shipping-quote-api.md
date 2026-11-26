# API de cotacao simulada (etapa 3)

GET /api/v1/public/stores/{slug}/shipping-quotes/ retorna enabled (boolean).
POST na mesma rota recebe destination_postal_code e items (lista de product_id
e quantity). Nao aceita preco, prazo, store_id ou campos extras.
A loja ativa e resolvida pelo slug; headers de tenant nao substituem o slug.
Produtos e configuracoes sao consultados somente no tenant correspondente.
GET desabilitado retorna enabled false; POST desabilitado retorna 404.
Dados invalidos retornam 400 com mensagem generica; limite por IP de 30/min
independente do checkout retorna 429. A flag permanece desativada por padrao.

Resposta POST: simulated=true, order_confirmation_available=false, quotes
com service, price (decimal string BRL), estimated_days, provider e notice.
Nao cria pedido, nao reserva estoque, nao persiste cotacao e nao altera totais.
O componente de checkout limpa selecao e resultados ao mudar CEP, itens ou
tenant, ignorando respostas antigas. A selecao e apenas demonstrativa.
Entrega local e retirada permanecem no fluxo existente. Confirmacao nacional
e revalidacao persistente ficam para etapa 4. Nenhuma tarifa e oficial.
