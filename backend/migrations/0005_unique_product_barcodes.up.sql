-- Backstop for the duplicate-code check in the product API: one active product per barcode per store,
-- so a scan can never match two products. If existing data already has duplicates the index is skipped
-- with a notice instead of failing startup; fix the duplicates and recreate it by hand.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM menu_items
        WHERE is_active AND COALESCE(barcode, '') <> ''
        GROUP BY restaurant_id, barcode
        HAVING COUNT(*) > 1
    ) THEN
        RAISE NOTICE 'Duplicate product barcodes found; uq_menu_items_active_barcode was not created';
    ELSE
        CREATE UNIQUE INDEX IF NOT EXISTS uq_menu_items_active_barcode
            ON menu_items (restaurant_id, barcode)
            WHERE is_active AND barcode IS NOT NULL AND barcode <> '';
    END IF;
END $$;
