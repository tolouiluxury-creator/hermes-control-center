import type { Dict } from './index';

/** Persian (Farsi) — right-to-left. */
export const fa: Dict = {
  // Navigation
  'nav.dashboard': 'داشبورد',
  'nav.chats': 'گفتگوها',
  'nav.agenten': 'ایجنت‌ها',
  'nav.workflows': 'گردش‌کارها',
  'nav.aufgaben': 'وظایف',
  'nav.wissen': 'دانش (RAG)',
  'nav.dokumente': 'اسناد',
  'nav.skills': 'مهارت‌ها',
  'nav.mcp': 'سرورهای MCP',
  'nav.modelle': 'مدل‌ها',
  'nav.browser': 'خودکارسازی مرورگر',
  'nav.dateien': 'فایل‌ها',
  'nav.prompts': 'کتابخانه پرامپت',
  'nav.integrationen': 'API و یکپارچه‌سازی‌ها',
  'nav.analytics': 'تحلیل‌ها',
  'nav.logs': 'گزارش‌ها',
  'nav.einstellungen': 'تنظیمات',

  // Common actions and labels
  'common.save': 'ذخیره',
  'common.saving': 'در حال ذخیره …',
  'common.cancel': 'انصراف',
  'common.delete': 'حذف',
  'common.remove': 'حذف',
  'common.new': 'جدید',
  'common.edit': 'ویرایش',
  'common.enable': 'فعال‌سازی',
  'common.disable': 'غیرفعال‌سازی',
  'common.test': 'آزمایش',
  'common.activate': 'فعال‌سازی',
  'common.apply': 'اعمال',
  'common.retry': 'تلاش دوباره',
  'common.search': 'جستجو',
  'common.running': 'در حال اجرا …',
  'common.active': 'فعال',
  'common.inactive': 'غیرفعال',
  'common.enabled': 'فعال شد',
  'common.disabled': 'غیرفعال شد',
  'common.confirm': 'تأیید',
  'common.all': 'همه',

  // Page descriptions
  'page.chats.desc':
    'مستقیم با ایجنت خود گفتگو کنید — از طریق داشبورد در حال اجرا، بدون سرور اضافی.',
  'page.agenten.desc':
    'پیش‌تنظیم‌های نام‌گذاری‌شده: مجموعه‌ای از مدل، مجموعه‌ابزار، مهارت‌ها و پرامپت سیستمی که ذخیره و اعمال می‌کنید. این‌ها در کنترل‌سنتر ذخیره می‌شوند، نه در هرمس.',
  'page.workflows.desc':
    'دنباله‌های نام‌گذاری‌شده و مرتب از پرامپت‌ها و کارهای زمان‌بندی‌شده. این‌جا ساخته می‌شوند؛ اجرای خودکار زنجیره با سرور API هرمس می‌آید.',
  'page.aufgaben.desc':
    'کارهای زمان‌بندی‌شده‌ای که ایجنت شما خودکار اجرا می‌کند. توقف، اجرا و حذف بر عملیات زنده اثر می‌گذارد.',
  'page.wissen.desc':
    'آنچه ایجنت شما به خاطر می‌سپارد: فایل‌های یادداشت داخلی و ارائه‌دهندگان حافظه در دسترس برای حافظه بلندمدت و بازیابی.',
  'page.skills.desc':
    'توانایی‌هایی که ایجنت شما می‌تواند استفاده کند. شمار استفاده نشان می‌دهد چه چیزی واقعاً به کار می‌رود.',
  'page.mcp.desc':
    'سرورهای ابزار متصل از طریق Model Context Protocol. هر سرور ابزارهای تازه‌ای به ایجنت شما می‌آموزد.',
  'page.modelle.desc': 'ارائه‌دهندگانی که هرمس شما می‌شناسد و مدلی که هم‌اکنون با آن کار می‌کند.',
  'page.prompts.desc':
    'قالب‌های خودتان. این‌ها در کنترل‌سنتر ذخیره می‌شوند، نه در هرمس — هرمس کتابخانه پرامپت ندارد.',
  'page.integrationen.desc':
    'اینکه ایجنت شما چگونه به دنیای بیرون می‌رسد: پلتفرم‌های پیام‌رسان، وب‌هوک‌های ورودی و کاربران مجاز برای آن‌ها.',
  'page.einstellungen.desc': 'پیکربندی، کلیدها، ابزارها و نگهداری هرمس شما.',

  // Chat
  'chat.newConversation': 'گفتگوی جدید',
  'chat.noConversations': 'هنوز گفتگویی نیست.',
  'chat.emptyTitle': 'گفتگوی جدید',
  'chat.emptyHint': 'برای شروع، پایین یک پیام بنویسید.',
  'chat.placeholder': 'پیام به ایجنت … (اینتر ارسال می‌کند)',
  'chat.connecting': 'در حال اتصال …',
  'chat.send': 'ارسال',
  'chat.messages': 'پیام',
  'chat.conversation': 'گفتگو',
  'chat.overDashboard':
    'گفتگو از طریق داشبورد هرمس اجرا می‌شود. بررسی کنید که داشبورد در دسترس است.',
  'chat.sendFailed': 'ارسال ناموفق بود',
  'chat.openFailed': 'باز کردن ناموفق بود',
  'chat.connectFailed': 'اتصال ناموفق بود',

  // Settings
  'settings.appearance': 'ظاهر',
  'settings.appearance.desc': 'فقط برای این دستگاه اعمال می‌شود.',
  'settings.language': 'زبان',
  'settings.language.desc': 'زبان رابط کاربری، برای این دستگاه.',
  'settings.theme.dark': 'تیره',
  'settings.theme.light': 'روشن',
  'settings.theme.system': 'سیستم',
  'settings.tools': 'ابزارها',
  'settings.tools.desc': 'مجموعه‌ابزارهایی که در اختیار ایجنت شماست.',
  'settings.tools.unavailable': 'در دسترس نیست',
  'settings.maintenance': 'نگهداری',
  'settings.maintenance.desc': 'نسخه و نگهداری حافظه بلندمدت.',
  'settings.version': 'نسخه',
  'settings.updateAvailable': 'به‌روزرسانی موجود است — روی سرور: {command}',
  'settings.curator': 'سرپرست حافظه',
  'settings.curator.paused': 'متوقف',
  'settings.curator.off': 'خاموش',
  'settings.curator.runNow': 'اکنون اجرا کن',
  'settings.curator.resume': 'ادامه',
  'settings.curator.pause': 'توقف',
  'settings.curator.lastRun': 'آخرین اجرا {time}',
  'settings.env': 'محیط و کلیدها',
  'settings.env.desc':
    'کلیدهای API و متغیرهای محیطی هرمس شما. مقادیر هرگز به‌صورت متن آشکار نمایش داده نمی‌شوند.',
  'settings.env.set': 'تنظیم',
  'settings.env.change': 'تغییر',
  'settings.env.count': '{count} متغیر',
  'settings.env.none': 'هیچ متغیری با این انتخاب هم‌خوانی ندارد.',
  'settings.env.valueFor': 'مقدار برای {key}',
  'settings.env.removeConfirm': '{key} حذف شود؟ مقدار از دست می‌رود.',
  'settings.env.scope.set': 'تنظیم‌شده',
  'settings.env.limited': 'فقط ۱۰۰ مورد اول نمایش داده می‌شود — برای یافتن بیشتر جستجو کنید.',
  'settings.config': 'پیکربندی خام (YAML)',
  'settings.config.desc':
    'پیکربندی کامل هرمس. اشتباه این‌جا می‌تواند ایجنت را مختل کند — با دقت ویرایش کنید.',
  'settings.config.empty': '(خالی)',
  'settings.config.overwriteConfirm':
    'پیکربندی بازنویسی شود؟ YAML نامعتبر می‌تواند بر ایجنت اثر بگذارد.',
  'settings.security': 'امنیت',
  'settings.security.desc': 'دسترسی به خود کنترل‌سنتر.',
  'settings.security.password':
    'رمز عبور کنترل‌سنتر روی سرور تنظیم می‌شود: {command}. تا زمانی که تنظیم نشود، سرور فقط به localhost متصل می‌شود.',
};
