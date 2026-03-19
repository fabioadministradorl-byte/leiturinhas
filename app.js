/**
 * app.js
 * Servidor Express principal do Leiturinhas
 */

import express from 'express';
import session from 'express-session';
import classroomRoutes from './routes/classroom.js';
import dotenv from 'dotenv';
dotenv.config();

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sessão (em produção use connect-pg-simple ou similar)
app.use(session({
  secret: process.env.SESSION_SECRET || 'leiturinhas-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dias
  },
}));

// Serve o frontend (pasta public/)
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
app.use(express.static(join(__dirname, 'public')));

// Rotas Google Classroom
app.use('/classroom', classroomRoutes);

// Rota de status
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    professorLogado: !!req.session?.professor,
    professor: req.session?.professor?.nome || null,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Leiturinhas rodando em http://localhost:${PORT}`);
  console.log(`📋 Login Google: http://localhost:${PORT}/classroom/login\n`);
});

export default app;
