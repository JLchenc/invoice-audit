# 控制面路由（admin）：给管理端用的接口——Key 管理、规则版本、评测、trace、仪表盘、知识库
# 与 biz.py（业务面：上传/复核）同挂 /api 前缀，靠模块和 tags 区分边界，不拆服务
# 现在还是空壳：按 P6 文档填充 /api/providers /api/rules /api/traces /api/dashboard /api/kb
from fastapi  import APIRouter

router=APIRouter(prefix="/api",tags=["admin"])
