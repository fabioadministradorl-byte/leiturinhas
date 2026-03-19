# Leiturinhas — Integração Google Classroom

## O que essa integração faz

| Funcionalidade | Descrição |
|---|---|
| Login com Google | Professor entra com a conta da escola |
| Importar turmas | Puxa turmas e alunos direto do Classroom |
| Postar aviso | Manda link da trilha no feed da turma |
| Criar atividade | Publica leitura com prazo no Classroom |
| Trilha semanal | Posta as 5 leituras da semana como uma atividade só |

---

## Passo a passo — configurar no Google Cloud

### 1. Criar projeto no Google Cloud Console

1. Acesse https://console.cloud.google.com
2. Clique em **"Selecionar projeto"** → **"Novo projeto"**
3. Nome: `Leiturinhas` → **Criar**

### 2. Ativar a Google Classroom API

1. No menu lateral: **APIs e Serviços** → **Biblioteca**
2. Pesquise: `Google Classroom API`
3. Clique em **Ativar**

### 3. Criar credenciais OAuth 2.0

1. **APIs e Serviços** → **Credenciais** → **+ Criar credenciais** → **ID do cliente OAuth**
2. Tipo: **Aplicativo da Web**
3. Nome: `Leiturinhas Web`
4. URIs de redirecionamento autorizados:
   - Desenvolvimento: `http://localhost:3000/classroom/callback`
   - Produção: `https://seudominio.com/classroom/callback`
5. Clique em **Criar**
6. Copie o **Client ID** e **Client Secret**

### 4. Configurar tela de consentimento OAuth

1. **APIs e Serviços** → **Tela de consentimento OAuth**
2. Tipo de usuário: **Externo** (ou Interno se for Google Workspace da escola)
3. Preencha: nome do app, email de suporte, domínio
4. Escopos necessários:
   - `classroom.courses.readonly`
   - `classroom.rosters.readonly`
   - `classroom.announcements`
   - `classroom.coursework.students`
5. Adicione emails de teste durante desenvolvimento

> **Dica:** Se a escola usa Google Workspace for Education, escolha **Interno** — não precisa de verificação do Google.

---

## Instalação

```bash
# Clone ou crie a pasta do projeto
cd leiturinhas-google

# Instale as dependências
npm install

# Configure as variáveis de ambiente
cp .env.example .env
# Edite o .env com suas credenciais

# Rode em desenvolvimento
npm run dev
```

---

## Fluxo de autenticação

```
Professor clica "Entrar com Google"
        ↓
GET /classroom/login
        ↓
Redireciona para Google (tela de consentimento)
        ↓
Professor autoriza o Leiturinhas
        ↓
GET /classroom/callback?code=xxx
        ↓
Troca código por tokens
        ↓
Salva tokens na sessão/banco
        ↓
Redireciona para /dashboard
```

---

## Endpoints disponíveis

### Autenticação
```
GET  /classroom/login              → Inicia login com Google
GET  /classroom/callback           → Callback após login (automático)
POST /classroom/logout             → Encerra sessão
```

### Turmas
```
GET  /classroom/turmas             → Lista turmas + alunos do professor
GET  /classroom/turmas/:id/alunos  → Alunos de uma turma específica
```

### Publicar
```
POST /classroom/turmas/:id/aviso     → Posta aviso simples no feed
POST /classroom/turmas/:id/atividade → Cria atividade com prazo
POST /classroom/turmas/:id/trilha    → Posta trilha semanal completa
```

---

## Exemplos de uso (frontend)

### Importar turmas
```javascript
const res = await fetch('/classroom/turmas');
const { turmas } = await res.json();

// turmas = [{ id, nome, secao, alunos: [...], totalAlunos }]
turmas.forEach(t => {
  console.log(`${t.nome} — ${t.totalAlunos} alunos`);
});
```

### Postar trilha semanal
```javascript
await fetch('/classroom/turmas/TURMA_ID/trilha', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    semana: '18/03 a 22/03',
    linkBase: 'https://leiturinhas.app/turma/5A',
    trilha: [
      { titulo: 'O Peixe Dourado',     disciplina: 'Português',  tipo: 'Narrativo'   },
      { titulo: 'Como as plantas respiram', disciplina: 'Ciências', tipo: 'Informativo' },
      { titulo: 'Rio Amazonas',         disciplina: 'Geografia',  tipo: 'Informativo' },
      { titulo: 'A Proclamação',        disciplina: 'História',   tipo: 'Narrativo'   },
      { titulo: 'Problema da feira',    disciplina: 'Matemática', tipo: 'Instrucional'},
    ],
  }),
});
```

---

## Em produção — pontos importantes

### Tokens no banco de dados
Em vez de sessão, salve os tokens no banco:
```sql
CREATE TABLE professores_google (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_id   TEXT UNIQUE NOT NULL,
  nome        TEXT NOT NULL,
  email       TEXT NOT NULL,
  access_token  TEXT,
  refresh_token TEXT NOT NULL,  -- NUNCA perca esse campo
  token_expiry  BIGINT,
  criado_em   TIMESTAMP DEFAULT NOW()
);
```

### Renovação automática de tokens
O `access_token` expira em 1 hora. O `googleapis` renova automaticamente usando o `refresh_token` — mas você precisa salvar o novo token quando ele renovar:
```javascript
oauth2Client.on('tokens', async (novosTokens) => {
  await db.atualizarTokens(professorId, novosTokens);
});
```

### Domínio da escola (Google Workspace)
Se a escola usa Google Workspace for Education, configure o app como **Interno** no console — isso dispensa verificação e os professores não veem a tela de aviso "app não verificado".

---

## Estrutura de arquivos

```
leiturinhas-google/
├── app.js                  ← Servidor Express principal
├── googleClassroom.js      ← Funções da Classroom API
├── routes/
│   └── classroom.js        ← Rotas HTTP
├── .env.example            ← Template de variáveis de ambiente
├── .env                    ← Suas credenciais (nunca comite isso!)
└── package.json
```
