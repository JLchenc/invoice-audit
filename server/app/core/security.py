"""Fernet 对称加密：LLM provider Key 等敏感配置，落库前加密、用时解密。"""

import base64
import hashlib
import hmac
import json
import time

# cryptography 是 python 加密标库；Fernet 是加密算法
from cryptography.fernet import Fernet

# 把字符串对象变成 Fernet 对象。key 必须是字节，这里做了 str->bytes 兜底
def get_fernet(key:str)->Fernet:
    return Fernet(key.encode() if isinstance(key,str) else key)

# 加密：把字符串加密成 bytes 对象
def encrypt_value(plaintext:str,key:str)->str:
    return get_fernet(key).encrypt(plaintext.encode()).decode()

# 解密：把 bytes 对象解密成字符串
def decrypt_value(token:str,key:str)->str:
    return get_fernet(key).decrypt(token.encode()).decode()

def _b64(data:bytes)->str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def _b64dec(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))   # 补回 padding

def create_token(username: str, secret: str, hours: int = 12) -> str:
    header = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = _b64(json.dumps({"sub": username, "exp": int(time.time()) + hours * 3600}).encode())
    sig = _b64(hmac.new(secret.encode(), f"{header}.{payload}".encode(),
                        hashlib.sha256).digest())
    return f"{header}.{payload}.{sig}"


def verify_token(token: str, secret: str) -> str | None:
    """验签 + 验过期。通过返回用户名，否则 None。"""
    try:
        header, payload, sig = token.split(".")
        expected = _b64(hmac.new(secret.encode(), f"{header}.{payload}".encode(),
                                 hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):        # 常数时间比较，防时序攻击
            return None
        data = json.loads(_b64dec(payload))
        if data.get("exp", 0) < time.time():
            return None
        return data.get("sub")
    except Exception:
        return None
