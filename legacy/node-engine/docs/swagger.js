const swaggerJsDoc = require('swagger-jsdoc');

const swaggerOptions = {
  swaggerDefinition: {
    openapi: '3.0.0',
    info: {
      title: 'BipFlow Node Order Integration Engine',
      version: '1.0.0',
      description:
        'Documentacao do motor Node independente da raiz. O produto principal Django + Vue esta documentado em docs/api/reference.md.',
      contact: {
        name: 'Ednaldo Aquino',
        url: 'https://github.com/edaquinogit/BipFlow',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Local Node integration engine',
      },
    ],
    components: {
      schemas: {
        Item: {
          type: 'object',
          properties: {
            idItem: { type: 'string', example: 'SKU-990' },
            quantidadeItem: { type: 'integer', example: 2 },
            valorItem: { type: 'number', example: 100.0 },
          },
        },
        OrderRequest: {
          type: 'object',
          required: ['numeroPedido', 'valorTotal', 'dataCriacao'],
          properties: {
            numeroPedido: {
              type: 'string',
              example: 'v10089015vdb-01',
              description: 'ID original do pedido que sera sanitizado pelo motor.',
            },
            valorTotal: {
              type: 'number',
              example: 285.9,
            },
            dataCriacao: {
              type: 'string',
              format: 'date-time',
              example: '2026-03-08T12:00:00Z',
            },
            items: {
              type: 'array',
              items: { $ref: '#/components/schemas/Item' },
            },
          },
        },
        OrderResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'Success' },
            orderId: { type: 'string', example: 'v10089015vdb' },
          },
        },
      },
    },
    paths: {
      '/api/v1/orders': {
        post: {
          tags: ['Orders'],
          summary: 'Integra um novo pedido no motor Node',
          description:
            'Recebe o payload, sanitiza numeroPedido removendo sufixos e persiste pedido e itens no SQLite local do motor Node.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/OrderRequest' },
              },
            },
          },
          responses: {
            201: {
              description: 'Pedido processado e persistido com sucesso.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/OrderResponse' },
                },
              },
            },
            400: {
              description: 'Erro de validacao ou duplicidade de dados.',
            },
          },
        },
      },
      '/health': {
        get: {
          tags: ['Monitoring'],
          summary: 'Verifica o status do motor Node',
          responses: {
            200: {
              description: 'Motor Node esta online',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'UP' },
                      timestamp: { type: 'string', example: '2026-03-08T12:00:00Z' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  apis: [],
};

module.exports = swaggerJsDoc(swaggerOptions);
