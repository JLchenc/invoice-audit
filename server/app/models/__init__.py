# 只要「import app.models」就会执行下面两行，把 15 张表都注册到 Base.metadata
# 这样 Alembic 的 target_metadata 才能一次看到 app+ctrl 两套表
from app.models import app_models, ctrl_models  # noqa: F401