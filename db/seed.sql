-- Family Dinner App — Seed Data
-- Run AFTER schema.sql: psql -U forbell -d family_dinner -h localhost -f db/seed.sql
-- Safe to re-run (ON CONFLICT DO NOTHING on config)

-- ============================================================
-- MEALS (master catalog, 17 entries)
-- ============================================================
TRUNCATE meal_rotation, daily_overrides, meal_votes, cook_log, val_energy RESTART IDENTITY CASCADE;
TRUNCATE meals, family_members RESTART IDENTITY CASCADE;

INSERT INTO meals (name, notes, recipe_tips, active_time_min, total_time_min, equipment, cook, kid_rating, is_new, is_protected, tags) VALUES

-- 1
('Spaghetti & Meatballs / Salad / Garlic Bread',
 'Frozen meatballs fine. Dad''s garlic paste. Simple win.',
 NULL, 15, 30, ARRAY['pot', 'oven'], '👩‍🍳 or 👨‍🍳', '🟢', false, false,
 ARRAY['pasta', 'italian', 'crowd-pleaser']),

-- 2
('Dad''s All-Meat Chili',
 'Make a double batch — adults/son + leftover lunches. Daughter gets quesadilla or hot dogs alongside.',
 NULL, 20, 60, ARRAY['pot'], '👨‍🍳', '🔵', false, false,
 ARRAY['chili', 'leftovers', 'bulk-cook']),

-- 3
('Chicken Adobo / White Rice (Instant Pot)',
 'IP makes it fast. Kids get plain rice + chicken nuggets or alternate protein if needed.',
 NULL, 10, 35, ARRAY['instant-pot'], '👨‍🍳', '🟡', false, false,
 ARRAY['chicken', 'asian', 'instant-pot']),

-- 4 — Thursday protected night
('Thursday Night Out',
 'Protected night. No cooking. Friends deliver / Chipotle / Panda / Popeye''s.',
 NULL, 0, 0, ARRAY[]::text[], '—', '🟢', false, true,
 ARRAY['takeout', 'protected']),

-- 5
('Pesto Pasta with Italian Sausage & Peas',
 'Costco pesto. Crowd pleaser. Low effort Friday.',
 NULL, 10, 25, ARRAY['pot', 'skillet'], '👨‍🍳', '🟢', false, false,
 ARRAY['pasta', 'italian', 'easy', 'friday']),

-- 6 ★ NEW
('Sheet Pan Chicken Fajitas',
 'Chicken thighs, peppers, onions, fajita seasoning — all on one pan at 425°. Serve with warm tortillas, taco bar style. Kids love the DIY format.',
 'Slice chicken thighs thin, mix with sliced peppers + onions. Toss with oil, cumin, chili powder, garlic powder, smoked paprika, S&P. Spread on sheet pan at 425°F for 25-30 min. Char under broiler 2-3 min at end. Serve with warm flour tortillas and a taco bar spread.',
 10, 45, ARRAY['sheet-pan', 'oven'], '👨‍🍳', '🟢', true, false,
 ARRAY['chicken', 'tex-mex', 'sheet-pan', 'taco-bar']),

-- 7
('Alex''s Lasagna',
 'Project meal for Alex''s good week. Makes 2+ meals worth. Freeze a pan.',
 NULL, 45, 120, ARRAY['baking-dish', 'oven'], '👩‍🍳', '🟢', false, false,
 ARRAY['italian', 'pasta', 'project-meal', 'freezer-friendly', 'leftovers']),

-- 8
('Carne Asada Tacos — Taco Bar',
 'Full taco bar: crema, salsa, guac, cheese, jalapeños. Everyone builds their own.',
 NULL, 20, 30, ARRAY['grill or skillet'], '👨‍🍳', '🟢', false, false,
 ARRAY['tacos', 'tex-mex', 'taco-bar', 'crowd-pleaser']),

-- 9 ★ NEW
('Slow Cooker Pulled Pork',
 'Pork shoulder + simple dry rub in SC all day. Serve on buns with coleslaw/pickles. Leftovers = pulled pork quesadillas next day.',
 'Pork shoulder (Boston butt) 4-6 lbs. Dry rub: brown sugar, paprika, cumin, garlic powder, onion powder, S&P, cayenne. Rub the night before. SC on low 8-10 hrs. Shred with forks. Serve on brioche buns with coleslaw and pickles. Leftover hack: pulled pork quesadillas next day, or over rice. Freezes perfectly.',
 10, 600, ARRAY['slow-cooker'], '👨‍🍳', '🟢', true, false,
 ARRAY['pork', 'slow-cooker', 'leftovers', 'bulk-cook', 'freezer-friendly']),

-- 10
('Chicken Burrito Night',
 'Chicken breast/tenderloin, rice, beans (for adults), cheese, pico. Build-your-own bar again.',
 NULL, 20, 30, ARRAY['skillet', 'pot'], '👨‍🍳', '🟢', false, false,
 ARRAY['chicken', 'tex-mex', 'build-your-own', 'taco-bar']),

-- 11
('Burgers & Fries',
 'Classic low-key Friday. Air fryer or oven fries.',
 NULL, 15, 30, ARRAY['grill or skillet', 'air-fryer or oven'], '👨‍🍳', '🟢', false, false,
 ARRAY['burgers', 'easy', 'friday', 'crowd-pleaser']),

-- 12 ★ NEW
('Shrimp Tacos (+ chicken option)',
 'Grilled/sautéed shrimp, slaw, chipotle crema. Daughter will love. Son gets chicken version same taco bar.',
 'Large shrimp, season with chili-lime or fajita blend. Sauté 2 min per side. Quick slaw: shredded cabbage, lime juice, a little mayo, cilantro (optional). Chipotle crema: sour cream + canned chipotles in adobo blended. Daughter loves this. Son gets same setup with chicken breast strips.',
 15, 20, ARRAY['skillet'], '👨‍🍳', '🟡', true, false,
 ARRAY['shrimp', 'seafood', 'tacos', 'taco-bar']),

-- 13
('Alex''s Chicken Enchilada Bake or Italian Casserole',
 'Alex''s project meal of the week. Pick based on her energy and what sounds good.',
 NULL, 40, 90, ARRAY['baking-dish', 'oven'], '👩‍🍳', '🟢', false, false,
 ARRAY['chicken', 'project-meal', 'casserole', 'leftovers']),

-- 14
('Dad''s Fried Rice — Protein of the Day',
 'Whatever protein is in the fridge (leftover chicken, shrimp, pork) + day-old rice + eggs, soy, sesame oil, scallions. Dad eyeballs.',
 NULL, 15, 20, ARRAY['wok or large skillet'], '👨‍🍳', '🟢', false, false,
 ARRAY['fried-rice', 'asian', 'leftovers', 'flexible']),

-- 15 ★ NEW
('Teriyaki Chicken Bowls',
 'Chicken thighs, teriyaki glaze, steamed rice, edamame or broccoli. Simple. Kids universally love teriyaki.',
 'Chicken thighs glazed with teriyaki (soy sauce, mirin, honey, garlic, ginger). Bake at 400°F 25 min or sear in skillet. Serve over steamed rice with edamame or broccoli. Bottled Kikkoman works fine.',
 10, 30, ARRAY['skillet or oven'], '👨‍🍳', '🟢', true, false,
 ARRAY['chicken', 'asian', 'bowls', 'crowd-pleaser']),

-- 16 ★ NEW
('Elevated Ramen Night',
 'Dad controls a clean tonkotsu or shoyu broth base. Toppings bar: soft-boiled eggs, nori, corn, bamboo shoots, scallions. Alex''s note: keep broth clean — let the toppings bar do the work.',
 'Quality broth base — Costco tonkotsu/shoyu packets, or chicken broth + soy + miso + garlic + ginger simmered 10 min. KEEP BROTH CLEAN. Toppings bar: soft-boiled eggs (7 min, ice bath), nori, corn, bamboo shoots, scallions, sesame seeds, chili oil. Leftover pulled pork sliced thin = instant chashu sub.',
 15, 20, ARRAY['pot'], '👨‍🍳', '🟢', true, false,
 ARRAY['ramen', 'asian', 'toppings-bar', 'japanese']),

-- 17 ★ NEW
('Gyoza Night + Fried Rice',
 'Frozen gyoza/dumplings pan-fried (Costco or BJ''s). Serve with Dad''s fried rice. Dipping sauce: soy + rice vinegar + chili oil. Low effort, high reward.',
 'Frozen gyoza (Costco potstickers). Heat oil, add dumplings flat-side down 2-3 min until golden. Add 1/4 cup water, cover, steam 5 min. Remove lid, cook off water. Dipping sauce: 2 tbsp soy + 1 tbsp rice vinegar + chili oil.',
 5, 15, ARRAY['skillet with lid'], '👨‍🍳 / 👩‍🍳', '🟢', true, false,
 ARRAY['dumplings', 'asian', 'fried-rice', 'japanese', 'crowd-pleaser']);


-- ============================================================
-- 3-WEEK ROTATION TEMPLATE
-- day_of_week: 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 7=Sun
-- ============================================================
INSERT INTO meal_rotation (week_number, day_of_week, meal_id) VALUES
-- Week 1
(1, 1, 1),  -- Mon: Spaghetti & Meatballs
(1, 2, 2),  -- Tue: Dad's All-Meat Chili
(1, 3, 3),  -- Wed: Chicken Adobo (IP)
(1, 4, 4),  -- Thu: Thursday Night Out
(1, 5, 5),  -- Fri: Pesto Pasta
(1, 6, 6),  -- Sat: Sheet Pan Chicken Fajitas ★
(1, 7, 7),  -- Sun: Alex's Lasagna

-- Week 2
(2, 1, 8),  -- Mon: Carne Asada Tacos
(2, 2, 9),  -- Tue: Slow Cooker Pulled Pork ★
(2, 3, 10), -- Wed: Chicken Burrito Night
(2, 4, 4),  -- Thu: Thursday Night Out
(2, 5, 11), -- Fri: Burgers & Fries
(2, 6, 12), -- Sat: Shrimp Tacos ★
(2, 7, 13), -- Sun: Alex's Chicken Enchilada Bake

-- Week 3 (Asian Lane)
(3, 1, 14), -- Mon: Dad's Fried Rice
(3, 2, 8),  -- Tue: Carne Asada Tacos (carry-over — always a win)
(3, 3, 15), -- Wed: Teriyaki Chicken Bowls ★
(3, 4, 4),  -- Thu: Thursday Night Out
(3, 5, 5),  -- Fri: Pesto Pasta (rotation staple)
(3, 6, 16), -- Sat: Elevated Ramen Night ★
(3, 7, 17); -- Sun: Gyoza Night + Fried Rice ★


-- ============================================================
-- FAMILY MEMBERS
-- ============================================================
INSERT INTO family_members (name, role, is_picky, hates_leftovers, avatar_emoji) VALUES
('Eric',      'parent', false, false, '👨‍🍳'),
('Alex',       'parent', false, false, '👩‍🍳'),
('Jordan',  'kid', false, true,  '🧑'),
('Casey', 'kid', true,  false, '👧');


-- ============================================================
-- APP CONFIG
-- ============================================================
-- rotation_start_date must be a Monday.
-- This sets which Monday was "Week 1 Day 1" of the 3-week cycle.
-- Adjust this date to whatever Monday you want Week 1 to start on.
INSERT INTO app_config (key, value)
VALUES ('rotation_start_date', '2026-02-23')  -- Monday Feb 23, 2026 = Week 1
ON CONFLICT (key) DO NOTHING;
