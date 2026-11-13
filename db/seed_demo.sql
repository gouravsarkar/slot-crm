-- Optional demo data (not loaded automatically). Dates are examples only:
-- the real event dates are managed from Admin > Event settings.
INSERT INTO events (name, venue) VALUES ('Manchester April 2027 (demo)', 'Main Stage');
SELECT create_default_bands(currval('events_id_seq')::smallint);
INSERT INTO event_days (event_id, event_date, label)
VALUES (currval('events_id_seq'), '2027-04-03', 'Saturday'),
       (currval('events_id_seq'), '2027-04-04', 'Sunday');
SELECT generate_slots(id) FROM event_days WHERE event_id = currval('events_id_seq');
