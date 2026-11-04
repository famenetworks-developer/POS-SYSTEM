$ErrorActionPreference = "Stop"
$baseUrl = "http://localhost:8080/api/v1"
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "   NovaMart Premium Super Shop POS & Retail Verification" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green

# 1. Health & Readiness check
$health = Invoke-RestMethod -Uri "http://localhost:8080/health" -Method Get
Write-Host "1. API Health status: $($health.data.status) ($($health.data.service))" -ForegroundColor Green

# 2. Login as Lead Cashier
$loginBody = @{
    email = "cashier@novamart.com"
    password = "cashier123"
} | ConvertTo-Json

$loginRes = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method Post -Body $loginBody -ContentType "application/json"
$cashierToken = $loginRes.data.access_token
$branchId = $loginRes.data.branches[0].id
$cashierId = $loginRes.data.user.id
$headers = @{ "Authorization" = "Bearer $cashierToken"; "Content-Type" = "application/json" }
Write-Host "2. Cashier logged in: $($loginRes.data.user.name), Branch: $($loginRes.data.branches[0].name)" -ForegroundColor Green

# 3. Quick Cashier PIN Login (PIN: 2222)
$pinBody = @{ branch_id = $branchId; pin = "2222" } | ConvertTo-Json
$pinAuth = Invoke-RestMethod -Uri "$baseUrl/auth/pin-login" -Method Post -Body $pinBody -ContentType "application/json"
Write-Host "3. Quick PIN login successful for branch: $($loginRes.data.branches[0].name)" -ForegroundColor Green

# 4. Bootstrap Super Shop POS
$bootstrap = Invoke-RestMethod -Uri "$baseUrl/pos/bootstrap?branch_id=$branchId" -Method Get -Headers $headers
$categories = $bootstrap.data.categories
$items = $bootstrap.data.items
$registers = $bootstrap.data.tables
$promotions = $bootstrap.data.promotions
Write-Host "4. POS Bootstrap success: $($categories.Count) departments, $($items.Count) grocery SKUs, $($registers.Count) registers, $($promotions.Count) active promotions." -ForegroundColor Green

# 5. Barcode Scan Verification (Teer Refined Sugar: 894110010001)
$barcodeItem = Invoke-RestMethod -Uri "$baseUrl/items/barcode/894110010001" -Method Get -Headers $headers
Write-Host "5. Barcode scan match: $($barcodeItem.data.name_en) ($($barcodeItem.data.brand)), Price: ৳ $($barcodeItem.data.base_price_minor / 100), Stock: $($barcodeItem.data.stock_quantity)" -ForegroundColor Green

# 6. Multi-Criteria Product Search
$searchRes = Invoke-RestMethod -Uri "$baseUrl/items/search?q=Fresh" -Method Get -Headers $headers
Write-Host "6. Multi-criteria search (q=Fresh) returned $($searchRes.data.Count) matching products." -ForegroundColor Green

# 7. Promotion Coupon Validation
$promoBody = @{ code = "NOVAFIRST"; subtotal_minor = 150000 } | ConvertTo-Json
$promoRes = Invoke-RestMethod -Uri "$baseUrl/promotions/validate" -Method Post -Body $promoBody -Headers $headers
Write-Host "7. Promotion validated: $($promoRes.data.name) -> Discount: ৳ $($promoRes.data.discount_minor / 100)" -ForegroundColor Green

# 8. Create Super Shop Walk-in Order (Discrete FMCG + Weighted Produce)
$orderBody = @{
    branch_id = $branchId
    type = "walk_in"
    notes = "Customer trolley checkout - Counter 01"
    items = @(
        @{
            item_id = $barcodeItem.data.id
            name_snapshot = $barcodeItem.data.name_en
            qty = 2
            unit_price_minor = $barcodeItem.data.base_price_minor
        },
        @{
            name_snapshot = "Fresh Imported Fuji Apples (kg)"
            qty = 1.250
            unit_price_minor = 32000
        }
    )
} | ConvertTo-Json -Depth 5

$order = Invoke-RestMethod -Uri "$baseUrl/orders" -Method Post -Body $orderBody -Headers $headers
$orderId = $order.data.id
Write-Host "8. Retail order created: Order #$($order.data.order_no) (UUID: $orderId), Total: ৳ $($order.data.total_minor / 100)" -ForegroundColor Green

# 9. Settle Payment at POS
$payBody = @{
    payments = @(
        @{
            method_code = "cash"
            amount_minor = $order.data.total_minor
        }
    )
    cash_received = 100000 # ৳ 1,000 cash tendered
} | ConvertTo-Json -Depth 5

$payRes = Invoke-RestMethod -Uri "$baseUrl/orders/$orderId/pay" -Method Post -Body $payBody -Headers $headers
Write-Host "9. Payment settled: Invoice $($payRes.data.invoice_no), Change Due: ৳ $($payRes.data.change_due_minor / 100)" -ForegroundColor Green

# 10. Thermal 80mm Receipt
$receipt = Invoke-RestMethod -Uri "$baseUrl/orders/$orderId/receipt" -Method Get -Headers $headers
Write-Host "10. 80mm Fiscal receipt verified: $($receipt.data.order.items.Count) line items, Invoiced: $($receipt.data.invoice_no)" -ForegroundColor Green

# 11. Customer Return & Restock
$refundBody = @{
    amount_minor = $order.data.total_minor
    reason = "Customer product return at customer care counter"
    restock = $true
} | ConvertTo-Json

$refundRequest = Invoke-RestMethod -Uri "$baseUrl/orders/$orderId/refund-request" -Method Post -Body $refundBody -Headers $headers
$managerLogin = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = "manager@novamart.com"; password = "manager123" } | ConvertTo-Json)
$managerHeaders = @{ Authorization = "Bearer $($managerLogin.data.access_token)"; "Content-Type" = "application/json" }
$decisionBody = @{ decision = "approved"; note = "Return inspected and approved by branch manager" } | ConvertTo-Json
$refundRes = Invoke-RestMethod -Uri "$baseUrl/approvals/$($refundRequest.data.id)/decision" -Method Post -Body $decisionBody -Headers $managerHeaders
Write-Host "11. Refund workflow completed: Request: $($refundRequest.data.status), Decision: $($refundRes.data.status)" -ForegroundColor Green

# 12. Retail Executive Dashboard
$dash = Invoke-RestMethod -Uri "$baseUrl/reports/dashboard?branch_id=$branchId" -Method Get -Headers $managerHeaders
Write-Host "12. Executive Dashboard: Invoiced Sales: ৳ $($dash.data.today_sales_minor / 100), Receipts: $($dash.data.today_orders)" -ForegroundColor Green

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "   ALL 12 NOVAMART VERIFICATION STEPS PASSED WITH 100%" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
