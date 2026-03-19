/**
 * googleClassroom.js
 * Integração completa com a Google Classroom API
 * 
 * SETUP NECESSÁRIO:
 * 1. Acesse: https://console.cloud.google.com
 * 2. Crie um projeto → ative "Google Classroom API"
 * 3. Crie credenciais OAuth 2.0 (Web application)
 * 4. Copie CLIENT_ID e CLIENT_SECRET para o .env
 * 5. Adicione redirect URI: http://localhost:3000/auth/google/callback
 */

// ─── Dependências ────────────────────────────────────────────────────────────
// npm install googleapis express express-session dotenv

import { google } from 'googleapis';
import dotenv from 'dotenv';
dotenv.config();

// ─── Configuração OAuth ───────────────────────────────────────────────────────
const SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',   // Ver turmas
  'https://www.googleapis.com/auth/classroom.rosters.readonly',   // Ver alunos
  'https://www.googleapis.com/auth/classroom.announcements',      // Postar avisos
  'https://www.googleapis.com/auth/classroom.coursework.students', // Criar atividades
  'https://www.googleapis.com/auth/userinfo.email',               // Email do professor
  'https://www.googleapis.com/auth/userinfo.profile',             // Nome do professor
];

function criarOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback'
  );
}

// ─── 1. AUTENTICAÇÃO ─────────────────────────────────────────────────────────

/**
 * Gera a URL de login com Google
 * Redirecione o professor para essa URL
 */
export function gerarUrlLogin() {
  const oauth2Client = criarOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',   // Recebe refresh_token para sessões longas
    prompt: 'consent',        // Garante receber o refresh_token sempre
    scope: SCOPES,
  });
}

/**
 * Troca o código de autorização por tokens de acesso
 * @param {string} code - Código retornado pelo Google após login
 * @returns {{ tokens, professor }} - Tokens e dados do professor
 */
export async function trocarCodigoPorTokens(code) {
  const oauth2Client = criarOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  // Busca dados do professor logado
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const { data: professor } = await oauth2.userinfo.get();

  return {
    tokens,  // Salve no banco: { access_token, refresh_token, expiry_date }
    professor: {
      id: professor.id,
      nome: professor.name,
      email: professor.email,
      foto: professor.picture,
    },
  };
}

/**
 * Cria cliente autenticado a partir de tokens salvos no banco
 * @param {{ access_token, refresh_token, expiry_date }} tokens
 */
export function criarClienteAutenticado(tokens) {
  const oauth2Client = criarOAuthClient();
  oauth2Client.setCredentials(tokens);

  // Renova o token automaticamente quando expirar
  oauth2Client.on('tokens', (novosTokens) => {
    if (novosTokens.refresh_token) {
      console.log('Novo refresh_token — atualize no banco:', novosTokens.refresh_token);
    }
    console.log('Token renovado automaticamente');
  });

  return oauth2Client;
}

// ─── 2. TURMAS ───────────────────────────────────────────────────────────────

/**
 * Lista todas as turmas do professor
 * @param {OAuth2Client} authClient
 * @returns {Turma[]}
 */
export async function listarTurmas(authClient) {
  const classroom = google.classroom({ version: 'v1', auth: authClient });

  const { data } = await classroom.courses.list({
    teacherId: 'me',
    courseStates: ['ACTIVE'],  // Só turmas ativas
    pageSize: 20,
  });

  if (!data.courses || data.courses.length === 0) return [];

  return data.courses.map(turma => ({
    id: turma.id,
    nome: turma.name,
    descricao: turma.description || '',
    secao: turma.section || '',
    sala: turma.room || '',
    codigoEntrada: turma.enrollmentCode || '',
    linkAlternativo: turma.alternateLink,
    criadaEm: turma.creationTime,
  }));
}

// ─── 3. ALUNOS ───────────────────────────────────────────────────────────────

/**
 * Lista alunos de uma turma específica
 * @param {OAuth2Client} authClient
 * @param {string} turmaId - ID da turma do Google Classroom
 * @returns {Aluno[]}
 */
export async function listarAlunos(authClient, turmaId) {
  const classroom = google.classroom({ version: 'v1', auth: authClient });

  const { data } = await classroom.courses.students.list({
    courseId: turmaId,
    pageSize: 100,
  });

  if (!data.students || data.students.length === 0) return [];

  return data.students.map(aluno => ({
    id: aluno.userId,
    nome: aluno.profile.name.fullName,
    email: aluno.profile.emailAddress,
    foto: aluno.profile.photoUrl,
  }));
}

/**
 * Importa todas as turmas com seus alunos de uma vez
 * @param {OAuth2Client} authClient
 * @returns {TurmaCompleta[]}
 */
export async function importarTurmasComAlunos(authClient) {
  const turmas = await listarTurmas(authClient);

  const turmasCompletas = await Promise.all(
    turmas.map(async (turma) => {
      const alunos = await listarAlunos(authClient, turma.id);
      return { ...turma, alunos, totalAlunos: alunos.length };
    })
  );

  return turmasCompletas;
}

// ─── 4. PUBLICAR NO CLASSROOM ─────────────────────────────────────────────────

/**
 * Posta um aviso simples com link para o Leiturinhas
 * @param {OAuth2Client} authClient
 * @param {string} turmaId
 * @param {{ titulo, texto, link }} opcoes
 */
export async function postarAviso(authClient, turmaId, { titulo, texto, link }) {
  const classroom = google.classroom({ version: 'v1', auth: authClient });

  const mensagem = `📖 *${titulo}*\n\n${texto}\n\n👉 Acesse: ${link}`;

  const { data } = await classroom.courses.announcements.create({
    courseId: turmaId,
    requestBody: {
      text: mensagem,
      state: 'PUBLISHED',
      materials: link ? [
        {
          link: {
            url: link,
            title: titulo,
          },
        },
      ] : [],
    },
  });

  return { id: data.id, link: data.alternateLink };
}

/**
 * Cria uma atividade com prazo no Google Classroom
 * @param {OAuth2Client} authClient
 * @param {string} turmaId
 * @param {{ titulo, instrucoes, link, prazo }} opcoes
 * prazo: Date ou string ISO '2025-09-20T23:59:00'
 */
export async function criarAtividade(authClient, turmaId, { titulo, instrucoes, link, prazo }) {
  const classroom = google.classroom({ version: 'v1', auth: authClient });

  const prazoDate = prazo ? new Date(prazo) : null;

  const { data } = await classroom.courses.courseWork.create({
    courseId: turmaId,
    requestBody: {
      title: titulo,
      description: instrucoes,
      workType: 'ASSIGNMENT',
      state: 'PUBLISHED',
      materials: [
        {
          link: {
            url: link,
            title: `📖 ${titulo} — Leiturinhas`,
          },
        },
      ],
      // Prazo (opcional)
      ...(prazoDate && {
        dueDate: {
          year: prazoDate.getFullYear(),
          month: prazoDate.getMonth() + 1,
          day: prazoDate.getDate(),
        },
        dueTime: {
          hours: 23,
          minutes: 59,
        },
      }),
      // Sem nota (só participação)
      maxPoints: 0,
    },
  });

  return { id: data.id, link: data.alternateLink };
}

/**
 * Posta a trilha semanal completa como atividade
 * @param {OAuth2Client} authClient
 * @param {string} turmaId
 * @param {{ semana, trilha, linkBase }} opcoes
 * trilha: [{ titulo, disciplina, tipo }]
 */
export async function postarTrilhaSemanal(authClient, turmaId, { semana, trilha, linkBase }) {
  const lista = trilha
    .map(t => `• [${t.disciplina}] ${t.titulo} (${t.tipo})`)
    .join('\n');

  const instrucoes =
    `📚 Trilha de Leitura — Semana de ${semana}\n\n` +
    `Leia os textos abaixo no Leiturinhas e responda as perguntas:\n\n` +
    `${lista}\n\n` +
    `✅ Complete todas as leituras até sexta-feira.`;

  return criarAtividade(authClient, turmaId, {
    titulo: `Trilha de Leitura — ${semana}`,
    instrucoes,
    link: linkBase || process.env.APP_URL || 'https://leiturinhas.app',
    prazo: proximaSexta(),
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function proximaSexta() {
  const hoje = new Date();
  const diasAteSexta = (5 - hoje.getDay() + 7) % 7 || 7;
  const sexta = new Date(hoje);
  sexta.setDate(hoje.getDate() + diasAteSexta);
  sexta.setHours(23, 59, 0, 0);
  return sexta;
}
