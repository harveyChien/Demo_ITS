-- Demo data for the image etc_tram_thu_phi_bien_so_ro.png.
-- Run after schema.sql. The upload endpoint also creates missing demo rows.
USE its_toll;

INSERT INTO toll_rates (station_id, vehicle_type_id, fee, effective_from)
SELECT ts.id, vt.id, 35000, CURRENT_DATE()
FROM toll_stations ts
JOIN vehicle_types vt ON vt.code = 'CAR_4'
WHERE ts.code = 'TRAM01'
  AND NOT EXISTS (
    SELECT 1 FROM toll_rates tr
    WHERE tr.station_id = ts.id AND tr.vehicle_type_id = vt.id
      AND tr.fee = 35000 AND tr.effective_to IS NULL
  );

INSERT INTO lanes (station_id, lane_no, direction)
SELECT ts.id, 3, 'in'
FROM toll_stations ts
WHERE ts.code = 'TRAM01'
  AND NOT EXISTS (
    SELECT 1 FROM lanes l WHERE l.station_id = ts.id AND l.lane_no = 3
  );
