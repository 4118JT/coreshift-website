UPDATE owners
SET password_hash = 'pbkdf2$100000$fe4ccf61a9cf43f2296566ec7c2d1e4c$acc54515a539cb468b3b82c35b138aef70dc65dad2124909ea3cde59f3550e4c'
WHERE id = -1001
  AND business_id = 'hourmark-public-demo';
