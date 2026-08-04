UPDATE businesses
SET name = 'CoreShift Demo Company'
WHERE id = 'hourmark-public-demo';
--> statement-breakpoint
UPDATE owners
SET email = 'demo@coreshift.app'
WHERE id = -1001
  AND business_id = 'hourmark-public-demo';
