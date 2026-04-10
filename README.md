# Cooking be easy

A web app for managing recipes, planning weekly meals, and generating grocery lists — with AI-powered ingredient extraction and USDA-backed unit conversions.

## Features

- **Recipe Library** — Upload a photo of an ingredient list; Claude AI extracts all ingredients, quantities, and units automatically
- **Dish Photos** — Attach photos of dishes you've cooked to each recipe
- **Weekly Planner** — Select which recipes you want to cook this week
- **Shopping List** — Auto-generated from your weekly plan, organized by grocery store section
  - Edit quantities, remove items, add extras
  - Checklist mode to check off items while shopping
- **Smart Merging** — Identical ingredients across recipes are combined intelligently

## Deploy to Vercel

### 1. Get API keys

Go to [console.anthropic.com](https://console.anthropic.com) and create an API key.

Go to [FoodData Central](https://fdc.nal.usda.gov/api-key-signup) and create a USDA API key.

### 2. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
gh repo create meal-maker --public --source=. --push
```

### 3. Deploy on Vercel

```bash
npx vercel
```

Or go to [vercel.com](https://vercel.com), import your GitHub repo, and deploy.

### 4. Add the environment variable

In your Vercel project dashboard → **Settings → Environment Variables**, add:

```
ANTHROPIC_API_KEY = sk-ant-...your key here...
USDA_FDC_API_KEY = ...your key here...
```

Then redeploy.

## Local Development

```bash
# Copy env file and add your keys
cp .env.example .env.local
# edit .env.local and add ANTHROPIC_API_KEY and USDA_FDC_API_KEY

npm install
npm run dev
# Open http://localhost:3000
```

## Grocery Pricing Notes

- Recipe detail pricing uses Walmart grocery search results for packaged items plus USDA produce averages, so no browser location permission is required.
- No extra pricing API key is needed for recipe detail estimates.
- The app caches recipe price estimates for 12 hours to reduce repeat API usage.
- Walmart-backed estimates are scraped from server-side search-result HTML and can vary with Walmart's currently returned assortment and pricing.

## Data Storage

All recipe data is stored in your browser's **localStorage** — no database needed. This means:
- Data persists across browser sessions on the same device
- Data is not shared between devices or browsers
- Clearing browser data will erase your recipes
