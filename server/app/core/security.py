"""Fernet 对称加密：LLM provider Key 等敏感配置，落库前加密、用时解密。"""

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