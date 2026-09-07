# Legacy (Arquivado)

Esta pasta guarda código **descontinuado** que **não faz parte do runtime
canônico** do Bip Flow. O runtime atual é:

- **Backend:** Django REST em [`bipdelivery/`](../bipdelivery)
- **Frontend:** Vue 3 + TypeScript em [`bipflow-frontend/`](../bipflow-frontend)

O conteúdo aqui é mantido apenas como **referência histórica e de portfólio**.
Não há integração entre estes artefatos e o produto principal.

## `node-engine/`

Motor independente em Node.js + Express + Better-SQLite3 que existia na raiz do
repositório (`index.js`, `src/`, `services/`, `database/`, `audit-db.js`,
`docs/swagger.js`). Expunha um protótipo de integração de pedidos com Swagger,
log estruturado (Pino) e validação (Zod).

Foi arquivado durante a **Fase 0** da evolução para multi-loja, com o objetivo
de consolidar o Django como backend canônico e eliminar a ambiguidade de "dois
backends" no repositório. O histórico completo permanece disponível via
`git log --follow`.

Para executá-lo de forma isolada (opcional, fora do fluxo principal):

```bash
cd legacy/node-engine
npm install
npm run dev   # http://localhost:3000  | Swagger em /api-docs
```

> ⚠️ Este código não é mantido. Não adicione dependências do produto a ele.
