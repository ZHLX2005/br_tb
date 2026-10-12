// 自注册入口:全部 import 一下,触发各文件的 Registry.register() 副作用。
// 加新命令 = 加一个文件 + 在这里多 import 一行。
import './init.mjs';
import './backup.mjs';
import './list.mjs';
import './show.mjs';
import './doctor.mjs';
import './version.mjs';
