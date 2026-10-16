# 내 PC에서 앱 열기: python serve.py  →  http://localhost:5500
# 코드를 고친 뒤 예전 파일이 브라우저 캐시에 남지 않도록 캐시를 끈다.
import http.server
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    print('진도관리: http://localhost:5500 (끄려면 Ctrl+C)')
    http.server.ThreadingHTTPServer(('localhost', 5500), NoCacheHandler).serve_forever()
