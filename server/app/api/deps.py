# ---------- biz.py / admin.py 共用的依赖（放 schemas.py 或单独 deps.py） ----------
from fastapi import Depends, HTTPException, Request

from app.core.config import get_settings
from app.core.security import verify_token


async def get_current_user(request: Request) -> str:
    settings = get_settings()
    if not settings.auth_enabled:                 # 演示模式：全放行
        return "anonymous"
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "未登录")
    username = verify_token(auth[7:], settings.token_secret)
    if username is None:
        raise HTTPException(401, "token 无效或已过期")
    return username
