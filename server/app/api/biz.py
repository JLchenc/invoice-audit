from fastapi import APIRouter

# 控制面：key 管理、模型管理、用户管理、日志管理、任务管理、数据管理
router=APIRouter(prefix="/biz",tags=["admin"])
# /api/biz/keys  /api/biz/models  - 按 BACKEND-PLAN 的接口文档来写