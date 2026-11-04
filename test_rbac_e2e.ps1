$ErrorActionPreference = 'Stop'
$base = 'http://localhost:8080/api/v1'

function Login($email, $password) {
  $body = @{ email = $email; password = $password } | ConvertTo-Json
  (Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body $body).data
}
function Status($token, $path) {
  try { Invoke-WebRequest -UseBasicParsing -Uri "$base$path" -Headers @{ Authorization = "Bearer $token" } | Out-Null; 200 }
  catch { [int]$_.Exception.Response.StatusCode }
}
function Post-Status($token, $path, $body) {
  try { Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$base$path" -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 5) | Out-Null; 200 }
  catch { [int]$_.Exception.Response.StatusCode }
}
function Assert-Code($actual, $expected, $label) {
  if ($actual -ne $expected) { throw "$label returned $actual; expected $expected" }
  Write-Host "PASS $label ($actual)" -ForegroundColor Green
}

$owner = Login 'owner@novamart.com' 'owner123'
$admin = Login 'tenantadmin@novamart.com' 'admin123'
$manager = Login 'manager@novamart.com' 'manager123'
$cashier = Login 'cashier@novamart.com' 'cashier123'
$inventory = Login 'inventory@novamart.com' 'inventory123'
$purchase = Login 'purchase@novamart.com' 'purchase123'
$branch = $cashier.branches[0].id

Assert-Code (Status $owner.access_token '/reports/profit-loss') 200 'Owner financial report'
Assert-Code (Status $admin.access_token '/users') 200 'Tenant Admin staff management'
Assert-Code (Status $admin.access_token '/reports/profit-loss') 403 'Tenant Admin financial restriction'
Assert-Code (Status $admin.access_token '/admin/restaurants') 403 'Tenant Admin platform restriction'
Assert-Code (Post-Status $admin.access_token '/users' @{ name='Escalation Attempt'; email='blocked-owner@novamart.test'; password='blocked123'; role='owner'; branch_ids=@($branch) }) 403 'Tenant Admin Owner-role escalation blocked'
Assert-Code (Status $manager.access_token "/reports/dashboard?branch_id=$branch") 200 'Manager branch dashboard'
Assert-Code (Status $manager.access_token '/reports/profit-loss') 403 'Manager company P&L restriction'
Assert-Code (Status $manager.access_token '/reports/dashboard?branch_id=00000000-0000-0000-0000-000000000000') 403 'Manager unassigned branch restriction'
Assert-Code (Status $cashier.access_token "/orders?branch_id=$branch") 200 'Cashier own transactions'
Assert-Code (Status $cashier.access_token "/reports/dashboard?branch_id=$branch") 403 'Cashier report restriction'
Assert-Code (Status $inventory.access_token "/stock?branch_id=$branch") 200 'Inventory stock access'
Assert-Code (Status $inventory.access_token '/users') 403 'Inventory user restriction'
Assert-Code (Status $purchase.access_token "/purchase-orders?branch_id=$branch") 200 'Purchase order access'
Assert-Code (Status $purchase.access_token '/reports/profit-loss') 403 'Purchase financial restriction'

Write-Host 'All RBAC end-to-end checks passed.' -ForegroundColor Cyan
