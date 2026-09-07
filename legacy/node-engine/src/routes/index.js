// --- src/routes/index.js ---
import { Router } from 'express';
const routes = Router();

routes.get('/health', (req, res) => res.json({ status: 'BipFlow Operational 🚀' }));

export default routes;

// --- src/app.js ---
import express from 'express';
import cors from 'cors';
import routes from './routes/index.js';

const app = express();

app.use(cors());
app.use(express.json());
app.use('/api', routes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[BipFlow] Server running on port ${PORT}`);
});