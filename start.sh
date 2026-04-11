#!/bin/bash

echo "正在启动食物语图鉴本地服务器..."
echo "服务器地址: http://localhost:8001"
echo "按 Ctrl+C 停止服务器"
echo ""

python3 -m http.server 8001
