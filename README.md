# Mais Náutico — API Server

API de notícias do Náutico Capibaribe para o app Android.
Agrega GE, NE10, Gazeta Esportiva, Folha PE e Google News em um único endpoint JSON.

## Endpoint

```
GET https://SEU-APP.onrender.com/noticias
GET https://SEU-APP.onrender.com/noticias?limit=30
GET https://SEU-APP.onrender.com/health
```

## Resposta JSON

```json
[
  {
    "title": "Náutico vence e se aproxima do G4",
    "link": "https://ge.globo.com/pe/futebol/times/nautico/noticia/...",
    "description": "Com gol de Danilo Boza no segundo tempo...",
    "image": "https://s2-ge.glbimg.com/...",
    "date": "2026-07-14T21:00:00.000Z",
    "source": "Globo Esporte",
    "color": "#C8102E"
  }
]
```

---

## Deploy no Render.com (passo a passo)

### Pré-requisitos
- Conta no [GitHub](https://github.com) (gratuita)
- Conta no [Render.com](https://render.com) (gratuita)

---

### Passo 1 — Subir o código no GitHub

1. Acesse [github.com](https://github.com) e faça login
2. Clique em **"New repository"** (botão verde no canto superior direito)
3. Nome: `maisnautico-api`
4. Deixe **Public** marcado
5. Clique em **"Create repository"**
6. Na próxima tela, copie a URL do repositório (ex: `https://github.com/seuusuario/maisnautico-api.git`)

Agora, no seu computador, abra o terminal na pasta `server` deste projeto:

```bash
cd d:\Android\Noticias\MaisNautico\server
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/maisnautico-api.git
git push -u origin main
```

---

### Passo 2 — Criar o serviço no Render

1. Acesse [render.com](https://render.com) e faça login
2. Clique em **"New +"** → **"Web Service"**
3. Clique em **"Connect account"** para conectar com seu GitHub
4. Selecione o repositório `maisnautico-api`
5. Configure:
   - **Name:** `maisnautico-api`
   - **Region:** `Oregon (US West)` (ou o mais próximo do Brasil disponível no plano free)
   - **Branch:** `main`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** `Free`
6. Clique em **"Create Web Service"**

O Render vai fazer o build automaticamente. Aguarde 2-3 minutos.

---

### Passo 3 — Pegar a URL do servidor

Após o deploy, o Render mostra a URL do seu serviço:
```
https://maisnautico-api.onrender.com
```

Teste no browser:
```
https://maisnautico-api.onrender.com/health
```

Deve retornar: `{"status":"ok","timestamp":"..."}`

---

### Passo 4 — Atualizar o app Android

No Android Studio, abra o `strings.xml` e adicione:

```xml
<string name="api_noticias_url">https://maisnautico-api.onrender.com</string>
```

O app já está configurado para usar essa URL automaticamente.

---

## Atualizações futuras

Para atualizar o servidor (adicionar fontes, corrigir bugs):
1. Edite os arquivos localmente
2. `git add . && git commit -m "descrição" && git push`
3. O Render faz o redeploy automático em ~1 minuto

## Importante — Plano Gratuito do Render

O plano gratuito "hiberna" o servidor após 15 minutos sem uso.
A primeira requisição após hibernação demora ~30 segundos para "acordar".
As requisições seguintes são instantâneas.

Para evitar hibernação, você pode usar um serviço gratuito como
[UptimeRobot](https://uptimerobot.com) para pingar `/health` a cada 14 minutos.
