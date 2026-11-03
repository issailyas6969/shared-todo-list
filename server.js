import express from 'express';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  DeleteCommand
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'crypto';

const app = express();
app.use(express.json());

// DynamoDB setup
const REGION = process.env.AWS_REGION;
const TABLE_NAME = process.env.TABLE_NAME;

if (!REGION || !TABLE_NAME) {
  console.error('Missing required env vars: AWS_REGION and TABLE_NAME');
  process.exit(1);
}

const ddbClient = new DynamoDBClient({ region: REGION });
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

// Health check
app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

// Serve the front‑end
app.get('/', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Shared To‑Do List</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root {
  --bg-light: #f9f9f9;
  --bg-dark: #1e1e1e;
  --text-light: #222;
  --text-dark: #eee;
  --accent: #0066ff;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: var(--bg-dark);
    --text: var(--text-dark);
  }
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: var(--bg-light);
    --text: var(--text-light);
  }
}
body {
  margin:0;
  font-family:system-ui, sans-serif;
  background: var(--bg);
  color: var(--text);
  display:flex;
  flex-direction:column;
  min-height:100vh;
}
header {
  background: var(--accent);
  color:#fff;
  padding:1rem;
  text-align:center;
}
main {
  flex:1;
  padding:1rem;
  max-width:600px;
  margin:auto;
}
form {
  display:flex;
  gap:0.5rem;
}
input[type="text"] {
  flex:1;
  padding:0.5rem;
  border:1px solid #ccc;
  border-radius:4px;
}
button {
  padding:0.5rem 1rem;
  background: var(--accent);
  color:#fff;
  border:none;
  border-radius:4px;
  cursor:pointer;
}
button:hover {
  opacity:0.9;
}
ul {
  list-style:none;
  padding:0;
}
li {
  display:flex;
  justify-content:space-between;
  align-items:center;
  padding:0.5rem;
  border-bottom:1px solid #ddd;
}
li button {
  background:#e00;
}
@media (max-width:480px) {
  form {
    flex-direction:column;
  }
}
</style>
</head>
<body>
<header><h1>Shared To‑Do List</h1></header>
<main>
  <form id="addForm" aria-label="Add new to‑do">
    <input type="text" id="newItem" placeholder="What needs to be done?" required aria-label="New to‑do">
    <button type="submit">Add</button>
  </form>
  <ul id="list" aria-live="polite"></ul>
</main>
<script>
const API_BASE = '';

async function fetchItems() {
  const resp = await fetch('/items');
  if (!resp.ok) return;
  const data = await resp.json();
  const ul = document.getElementById('list');
  ul.innerHTML = '';
  data.forEach(item => {
    const li = document.createElement('li');
    li.textContent = item.content;
    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.setAttribute('aria-label', 'Delete');
    delBtn.onclick = async () => {
      await fetch(\`/items/\${item.id}\`, { method: 'DELETE' });
      fetchItems();
    };
    li.appendChild(delBtn);
    ul.appendChild(li);
  });
}

document.getElementById('addForm').addEventListener('submit', async e => {
  e.preventDefault();
  const input = document.getElementById('newItem');
  const content = input.value.trim();
  if (!content) return;
  await fetch('/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  });
  input.value = '';
  fetchItems();
});

fetchItems();
</script>
</body>
</html>`);
});

// API: list items
app.get('/items', async (req, res) => {
  try {
    const cmd = new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': 'LIST' },
      ScanIndexForward: true // oldest first
    });
    const result = await ddbDocClient.send(cmd);
    const items = (result.Items || []).map(i => ({
      id: i.sk.replace('ITEM#', ''),
      content: i.content
    }));
    res.json(items);
  } catch (err) {
    console.error('Error fetching items:', err);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// API: add item
app.post('/items', async (req, res) => {
  const { content } = req.body;
  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'Invalid content' });
  }
  const id = uuidv4();
  const item = {
    pk: 'LIST',
    sk: `ITEM#${id}`,
    content,
    createdAt: new Date().toISOString()
  };
  try {
    await ddbDocClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
    res.status(201).json({ id });
  } catch (err) {
    console.error('Error adding item:', err);
    res.status(500).json({ error: 'Failed to add item' });
  }
});

// API: delete item
app.delete('/items/:id', async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: 'Missing id' });
  const key = {
    pk: 'LIST',
    sk: `ITEM#${id}`
  };
  try {
    await ddbDocClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: key }));
    res.status(204).end();
  } catch (err) {
    console.error('Error deleting item:', err);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(\`Server listening on port \${PORT}\`);
});
