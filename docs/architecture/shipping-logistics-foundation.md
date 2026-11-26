# Fundação logística do frete

## Objetivo

Esta etapa adiciona os dados necessários para uma futura cotação nacional sem alterar a lógica de entrega local. O cálculo de frete, simulador e integração com transportadoras pertencem às etapas seguintes.

## Dados de produto

- `weight_grams`: peso unitário do produto em gramas.
- `length_cm`, `width_cm`, `height_cm`: dimensões unitárias em centímetros.
- Os quatro campos são opcionais para preservar o cadastro e a venda de produtos já existentes.
- Um produto só poderá ser considerado elegível ao envio nacional quando os dados exigidos pelo motor de cotação estiverem preenchidos e válidos.

## Configuração por loja

`StoreShippingSettings` é uma relação OneToOne com `Store`, garantindo que origem e embalagens não sejam compartilhadas entre tenants.

- `national_shipping_enabled`: começa desativado por padrão.
- `origin_postal_code`: CEP de origem armazenado com oito dígitos.
- `packaging_weight_grams`: peso adicional padrão da embalagem.
- `package_options`: lista de embalagens com nome, comprimento, largura, altura e tara em gramas.

Estrutura esperada para cada embalagem:

```json
{
  "name": "Caixa pequena",
  "length_cm": 20,
  "width_cm": 15,
  "height_cm": 10,
  "tare_weight_grams": 80
}
```

A API de configuração resolve a loja pelo contexto autenticado e nunca aceita `store_id` enviado pelo cliente.

## Compatibilidade e segurança

- A migração cria configuração desativada para as lojas existentes.
- Novas lojas recebem configuração inicial desativada no fluxo de onboarding.
- A taxa fixa de `DeliveryRegion.delivery_fee` permanece inalterada.
- Não há chamada à API dos Correios, cálculo de preço, rastreamento, etiqueta ou deploy nesta etapa.
- O recurso só poderá ser habilitado após as etapas posteriores de cotação e checkout estarem concluídas e testadas.
