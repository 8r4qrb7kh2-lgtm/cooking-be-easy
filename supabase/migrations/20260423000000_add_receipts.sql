-- Grocery receipts: users upload receipt photos, AI extracts line items into a
-- personal price library that recipe pricing draws from.

create table if not exists receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  household_id uuid references households(id),
  store_name text,
  store_location text,
  purchase_date date,
  subtotal numeric(10,2),
  total numeric(10,2),
  currency_code text not null default 'USD',
  image_base64 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table receipts enable row level security;

create index if not exists receipts_user_id_idx on receipts (user_id);
create index if not exists receipts_household_id_idx on receipts (household_id);
create index if not exists receipts_purchase_date_idx on receipts (purchase_date desc);

create table if not exists receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid references receipts(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  household_id uuid references households(id),
  raw_label text not null,
  normalized_name text not null,
  brand text,
  section text,
  quantity numeric(12,3),
  unit text,
  package_size_text text,
  unit_price numeric(10,2),
  total_price numeric(10,2) not null,
  currency_code text not null default 'USD',
  purchased_at date,
  store_name text,
  confidence numeric(3,2),
  created_at timestamptz not null default now()
);
alter table receipt_items enable row level security;

create index if not exists receipt_items_receipt_id_idx on receipt_items (receipt_id);
create index if not exists receipt_items_user_id_idx on receipt_items (user_id);
create index if not exists receipt_items_household_id_idx on receipt_items (household_id);
create index if not exists receipt_items_normalized_name_idx on receipt_items (normalized_name);

create policy "Users manage own or household receipts"
  on receipts for all
  using (
    auth.uid() = user_id
    OR household_id IN (select household_id from household_members where user_id = auth.uid())
  );

create policy "Users manage own or household receipt items"
  on receipt_items for all
  using (
    auth.uid() = user_id
    OR household_id IN (select household_id from household_members where user_id = auth.uid())
  );
