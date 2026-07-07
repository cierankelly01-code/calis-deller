-- Starter config rows so the app has something to show on first run.
-- EDIT THESE to match Cali's Deller's actual staff and units — either
-- here before running, or afterwards in the app under Settings.

insert into staff (name, sort_order) values
  ('Staff Member 1', 1),
  ('Staff Member 2', 2)
on conflict do nothing;

insert into fridge_units (name, unit_type, target_min_c, target_max_c, sort_order) values
  ('Display Fridge', 'fridge', 1.0, 5.0, 1),
  ('Walk-in Fridge', 'fridge', 1.0, 5.0, 2),
  ('Freezer', 'freezer', -25.0, -18.0, 3)
on conflict do nothing;

-- Default cleaning checklist — edit in the app under Settings > Cleaning tasks.
insert into cleaning_tasks (name, session, sort_order) values
  ('Sanitise all work surfaces', 'both', 1),
  ('Sanitise chopping boards', 'both', 2),
  ('Clean & sanitise sinks', 'both', 3),
  ('Wipe down fridge/freezer handles & seals', 'open', 4),
  ('Check & empty bins', 'both', 5),
  ('Sweep & mop floors', 'close', 6),
  ('Clean slicer / mixer / equipment used today', 'close', 7),
  ('Wash & sanitise utensils', 'close', 8),
  ('Clean oven / grill', 'close', 9),
  ('Wipe display counter & serve-over unit', 'both', 10)
on conflict do nothing;

-- Example suppliers & products — replace with the real ones in the app.
insert into suppliers (name, sort_order) values
  ('Main Wholesaler', 1),
  ('Bakery Supplier', 2),
  ('Meat Supplier', 3)
on conflict do nothing;

insert into products (name, allergens, may_contain, notes) values
  ('Sausage Roll', array['gluten','eggs','sulphites'], array['milk','sesame'], 'Pastry contains wheat flour'),
  ('Cheese & Onion Pasty', array['gluten','milk','eggs'], array['sesame'], null),
  ('Chicken Tikka Baguette', array['gluten','milk'], array['mustard','sesame'], 'Tikka sauce contains yogurt')
on conflict do nothing;
