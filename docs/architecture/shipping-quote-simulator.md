# Motor de cotacao simulada (etapa 2)

Servico interno `simulate_shipping` em `bipdelivery/api/shipping_quotes.py`.
Recebe uma loja previamente resolvida por contexto confiavel, IDs de produtos,
quantidades e CEP. Consulta produtos e configuracao exclusivamente pelo tenant.
Nao cria registros, nao altera estoque, nao possui endpoint e nao ativa frete
nacional. A flag continua desativada; a futura API deve exigir autorizacao e flag
antes de chamar o simulador interno.

## Empacotamento
Ordena dimensoes unitarias, empilha pela menor dimensao, agrega quantidades
duplicadas e seleciona a caixa configurada de menor volume que comporte o
paralelepipedo resultante (permitindo rotacao do conjunto). Peso = soma dos
pesos unitarios + peso adicional padrao + tara da caixa. Limite de 100 unidades
e 20 caixas. Sem caixa compativel ou dados completos, retorna erro de dominio.
Nao representa otimizacao 3D, multipacotes, folgas ou limites oficiais de
transportadoras. Dimensoes de variantes usam os dados do produto pai.

## Simulacao
Peso faturavel = maior entre peso real e cubado (volume / divisor configuravel,
padrao ilustrativo 6000 cm3/kg). Arredonda para cima ao kg na precificacao.
Zona sintetica = diferenca absoluta do primeiro digito dos CEPs, limitada a 4;
nao representa distancia geografica. Preco = base + kg * taxa + zona * taxa.
Prazo = dias base + zona. Modalidades economica e expressa simuladas.
Valores ilustrativos, nunca oficiais. Rates e divisor sao configuraveis por
injecao de provedor confiavel no servidor; nao ha editor de tarifas por loja
nesta etapa. O contrato QuoteProvider permite substituicao futura.
Sem chamadas externas, sem persistencia de cotacoes ou integracao checkout.
