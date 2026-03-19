/**
 * routes/classroom.js
 * Rotas Express para integração com Google Classroom
 * 
 * Adicione no seu app.js:
 *   import classroomRoutes from './routes/classroom.js';
 *   app.use('/classroom', classroomRoutes);
 */

import express from 'express';
import {
  gerarUrlLogin,
  trocarCodigoPorTokens,
  criarClienteAutenticado,
  importarTurmasComAlunos,
  listarAlunos,
  postarAviso,
  criarAtividade,
  postarTrilhaSemanal,
} from '../googleClassroom.js';

const router = express.Router();

// ─── Middleware: verifica se professor está autenticado ───────────────────────
function requireAuth(req, res, next) {
  if (!req.session?.googleTokens) {
    return res.status(401).json({ erro: 'Não autenticado. Faça login com Google.' });
  }
  next();
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────

/**
 * GET /classroom/login
 * Redireciona para tela de login do Google
 */
router.get('/login', (req, res) => {
  const url = gerarUrlLogin();
  res.redirect(url);
});

/**
 * GET /classroom/callback
 * Google redireciona aqui após login
 * Salva tokens na sessão e redireciona para o dashboard
 */
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.redirect('/?erro=login_cancelado');
  }

  try {
    const { tokens, professor } = await trocarCodigoPorTokens(code);

    // Salva na sessão (em produção: salve no banco de dados!)
    req.session.googleTokens = tokens;
    req.session.professor = professor;

    /**
     * PRODUÇÃO: Salve os tokens no banco assim:
     * await db.professores.upsert({
     *   googleId: professor.id,
     *   nome: professor.nome,
     *   email: professor.email,
     *   accessToken: tokens.access_token,
     *   refreshToken: tokens.refresh_token,  // NUNCA perca isso
     *   tokenExpiry: tokens.expiry_date,
     * });
     */

    res.redirect('/?google=conectado');
  } catch (err) {
    console.error('Erro no callback Google:', err);
    res.redirect('/?erro=falha_login');
  }
});

/**
 * POST /classroom/logout
 * Remove tokens da sessão
 */
router.post('/logout', (req, res) => {
  delete req.session.googleTokens;
  delete req.session.professor;
  res.json({ ok: true });
});

// ─── TURMAS ───────────────────────────────────────────────────────────────────

/**
 * GET /classroom/turmas
 * Retorna todas as turmas do professor com alunos
 * 
 * Response: {
 *   turmas: [{ id, nome, descricao, secao, alunos: [...], totalAlunos }]
 * }
 */
router.get('/turmas', requireAuth, async (req, res) => {
  try {
    const authClient = criarClienteAutenticado(req.session.googleTokens);
    const turmas = await importarTurmasComAlunos(authClient);

    res.json({ turmas });
  } catch (err) {
    console.error('Erro ao listar turmas:', err);
    res.status(500).json({ erro: 'Não foi possível carregar as turmas do Google Classroom.' });
  }
});

/**
 * GET /classroom/turmas/:turmaId/alunos
 * Retorna alunos de uma turma específica
 */
router.get('/turmas/:turmaId/alunos', requireAuth, async (req, res) => {
  try {
    const authClient = criarClienteAutenticado(req.session.googleTokens);
    const alunos = await listarAlunos(authClient, req.params.turmaId);

    res.json({ alunos, total: alunos.length });
  } catch (err) {
    console.error('Erro ao listar alunos:', err);
    res.status(500).json({ erro: 'Não foi possível carregar os alunos.' });
  }
});

// ─── PUBLICAR ────────────────────────────────────────────────────────────────

/**
 * POST /classroom/turmas/:turmaId/aviso
 * Posta um aviso simples no feed da turma
 * 
 * Body: { titulo, texto, link }
 */
router.post('/turmas/:turmaId/aviso', requireAuth, async (req, res) => {
  const { titulo, texto, link } = req.body;

  if (!titulo || !texto) {
    return res.status(400).json({ erro: 'titulo e texto são obrigatórios.' });
  }

  try {
    const authClient = criarClienteAutenticado(req.session.googleTokens);
    const resultado = await postarAviso(authClient, req.params.turmaId, { titulo, texto, link });

    res.json({ ok: true, avisoId: resultado.id, link: resultado.link });
  } catch (err) {
    console.error('Erro ao postar aviso:', err);
    res.status(500).json({ erro: 'Não foi possível postar o aviso.' });
  }
});

/**
 * POST /classroom/turmas/:turmaId/atividade
 * Cria uma atividade com prazo no Classroom
 * 
 * Body: { titulo, instrucoes, link, prazo }
 * prazo: string ISO opcional — ex: "2025-09-20"
 */
router.post('/turmas/:turmaId/atividade', requireAuth, async (req, res) => {
  const { titulo, instrucoes, link, prazo } = req.body;

  if (!titulo || !instrucoes) {
    return res.status(400).json({ erro: 'titulo e instrucoes são obrigatórios.' });
  }

  try {
    const authClient = criarClienteAutenticado(req.session.googleTokens);
    const resultado = await criarAtividade(authClient, req.params.turmaId, {
      titulo, instrucoes, link, prazo,
    });

    res.json({ ok: true, atividadeId: resultado.id, link: resultado.link });
  } catch (err) {
    console.error('Erro ao criar atividade:', err);
    res.status(500).json({ erro: 'Não foi possível criar a atividade.' });
  }
});

/**
 * POST /classroom/turmas/:turmaId/trilha
 * Posta a trilha semanal completa como atividade
 * 
 * Body: {
 *   semana: "18/03 a 22/03",
 *   trilha: [{ titulo, disciplina, tipo }],
 *   linkBase: "https://leiturinhas.app/turma/5A"
 * }
 */
router.post('/turmas/:turmaId/trilha', requireAuth, async (req, res) => {
  const { semana, trilha, linkBase } = req.body;

  if (!trilha || !Array.isArray(trilha) || trilha.length === 0) {
    return res.status(400).json({ erro: 'trilha deve ser um array de histórias.' });
  }

  try {
    const authClient = criarClienteAutenticado(req.session.googleTokens);
    const resultado = await postarTrilhaSemanal(authClient, req.params.turmaId, {
      semana: semana || 'esta semana',
      trilha,
      linkBase,
    });

    res.json({ ok: true, atividadeId: resultado.id, link: resultado.link });
  } catch (err) {
    console.error('Erro ao postar trilha:', err);
    res.status(500).json({ erro: 'Não foi possível postar a trilha.' });
  }
});

export default router;
