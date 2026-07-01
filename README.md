# Dashboard de Ponto

Um dashboard web para monitoramento de cartão de ponto com cálculo automático de horas extras.

## Funcionalidades

- ✅ Registrar horários diários (entrada, saída do almoço, retorno, saída)
- ✅ Cálculo automático de horas trabalhadas e horas extras
- ✅ Edição e exclusão de registros
- ✅ Filtro por mês
- ✅ Gráfico visual de horas extras
- ✅ Exportação de dados em CSV
- ✅ Upload de foto do cartão de ponto com tentativa de OCR automático
- ✅ Interface com tema escuro
- ✅ Limpeza de todos os registros

## Instalação Local

```bash
# Clonar o repositório
git clone <seu-repositorio>
cd ponto-dash

# Criar ambiente virtual
python -m venv venv

# Ativar ambiente virtual
# Windows
venv\Scripts\activate
# Linux/Mac
source venv/bin/activate

# Instalar dependências
pip install -r requirements.txt

# Rodar a aplicação
python app.py
```

Acesse: http://127.0.0.1:5000

## Deploy na Vercel

1. Fazer push para GitHub
2. Conectar repositório na Vercel (vercel.com)
3. Selecionar "Python" como framework
4. Clicar em Deploy

A Vercel detectará automaticamente o arquivo `vercel.json` e fará o deploy correto.

## Estrutura de Arquivos

```
ponto-dash/
├── api/
│   └── index.py          # Entry point para Vercel
├── templates/
│   └── index.html        # Interface principal
├── tests/
│   └── test_app.py       # Testes
├── app.py                # Aplicação Flask
├── vercel.json           # Configuração Vercel
├── requirements.txt      # Dependências Python
└── README.md             # Este arquivo
```

## Tecnologias

- Flask (Python web framework)
- SQLite (banco de dados local)
- HTML/CSS (interface)
- Pillow + Tesseract (OCR para leitura de fotos)

## Notas

- O banco de dados SQLite é local, então cada deployment na Vercel terá dados diferentes
- Para persistência entre deployments, considere usar um banco de dados remoto como PostgreSQL
- A leitura de OCR funciona melhor com imagens nítidas e bem iluminadas
