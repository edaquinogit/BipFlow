// --- src/config/database.js ---
// Using the Singleton pattern to ensure a single connection
import 'dotenv/config';

export const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'bipflow_db',
};

// --- src/services/mapper.js ---
// The Mapper is crucial for transforming database data into domain objects
// This prevents your frontend from being tightly coupled to your SQL table structure.
export class DataMapper {
  static toDomain(raw) {
    return {
      id: raw.id,
      flowName: raw.flow_name, // Example of snake_case to camelCase conversion
      createdAt: new Date(raw.created_at),
    };
  }

  static toPersistence(domain) {
    return {
      flow_name: domain.flowName,
    };
  }
}

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
