from fastapi  import APIRouter

# prefix="/api" 让这个路由下所有路径自动带 /api 前缀
# 业务面：上传扫描件、复核决策
router=APIRouter(prefix="/api",tags=["biz"])
# /api/documents  /api/review-quene  - 按 BACKEND-PLAN 的接口文档来写
