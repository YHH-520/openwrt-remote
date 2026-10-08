#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 assets/www(正斜杠) 与 classes.dex 注入 apk。用法见 build.bat。"""
import sys, zipfile, os

def main():
    if len(sys.argv) != 5:
        print("usage: inject_assets.py <base.apk> <www_dir> <dex> <out.apk>")
        sys.exit(2)
    base, www, dex, out = sys.argv[1:5]
    tmp = out + ".tmp"
    with zipfile.ZipFile(base, 'r') as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            zout.writestr(item, zin.read(item.filename))
        # www 用正斜杠写入，避免 ERR_FILE_NOT_FOUND
        for root, dirs, files in os.walk(www):
            for f in files:
                p = os.path.join(root, f)
                rel = os.path.relpath(p, www).replace('\\', '/')
                zout.write(p, 'assets/www/' + rel)
        zout.write(dex, 'classes.dex')
    os.replace(tmp, out)
    print("injected ->", out)

if __name__ == '__main__':
    main()
