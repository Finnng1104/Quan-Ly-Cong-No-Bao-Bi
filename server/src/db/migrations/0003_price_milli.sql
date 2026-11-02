-- Unit prices may have up to 3 decimals (e.g. 0,5 đ per piece), so they are stored the same way
-- quantities are: an integer scaled by 1000. Existing whole-VND prices are multiplied by 1000.
-- Line amounts, totals and debts stay whole VND.
ALTER TABLE price_book RENAME COLUMN price TO price_milli;
ALTER TABLE order_lines RENAME COLUMN price TO price_milli;
ALTER TABLE return_lines RENAME COLUMN price TO price_milli;

UPDATE price_book SET price_milli = price_milli * 1000;
UPDATE order_lines SET price_milli = price_milli * 1000;
UPDATE return_lines SET price_milli = price_milli * 1000;
