/* Riversong — the few words on screen, in English and Turkish. */
'use strict';
RS.i18n = (() => {
  const STR = {
    en: {
      title: 'Riversong',
      listen: 'Touch the valley to listen',
      loading: 'Gathering stones…',
      noWebgl: 'Riversong needs a browser with WebGL 2 (a recent Chrome, Edge, Firefox or Safari).',
      tools: { stone: 'Stone', reed: 'Reed', twig: 'Twig', lantern: 'Lantern', atlas: 'Atlas', help: 'How it works' },
      toolTips: {
        stone: 'Tap water for a pebble, hold and it grows. Drag along water for gravel, across it for a waterfall.',
        reed: 'Paint along a bank. Hold first for taller reeds.',
        twig: 'Lay it across a stream to dam it.',
        lantern: 'Drop it on water. Two lanterns sing a round.',
        atlas: 'Your valleys',
        help: 'How it works',
      },
      times: ['Dawn', 'Morning', 'Golden hour', 'Dusk', 'Night'],
      hints: {
        draw: 'Drag across the land to draw water',
        pond: 'A lantern rides it. Lead a stream back into itself to make a pond',
        stone: 'Take a stone from the tray. Tap the water for a pebble, hold and it grows',
        more: 'Reeds give long tones. Pinch water, or Shift+scroll, to change its speed',
        twig: 'Lay a twig across a stream. Lift it and the lanterns pour out together',
        light: 'Drag the light to turn the day',
        zoom: 'Zoom all the way out to find your atlas',
        lift: 'Tap the twig to lift it',
      },
      help: [
        ['Draw water', 'Drag across the land. A lantern rides each stream from start to end, again and again.'],
        ['Pond', 'Lead a stream back into itself. A small pond repeats quickly, a lake unfolds slowly.'],
        ['Split', 'Start drawing on a stream to branch it. Lanterns take turns left and right.'],
        ['Erase', 'Rub back and forth over water (or right-drag) and the land closes over it.'],
        ['Stones', 'Tap water for a pebble; hold and it grows. Bigger sings lower. Drag along water for gravel, across it for a waterfall drum.'],
        ['Reeds', 'Paint along a bank for a long tone as long as the stretch. Hold first for taller, deeper reeds.'],
        ['Speed', 'Pinch the water narrow to run twice as fast, wide to drift at half speed. With a mouse: Shift+scroll over water.'],
        ['Lanterns', 'Drop a second lantern and the melody chases itself. Drag a lantern onto land to put it out.'],
        ['Dam', 'Lay a twig across a stream: lanterns gather behind it. Tap the twig to lift it and they pour out.'],
        ['Rain', 'Press and hold on open land. Each drop plays the stone it lands on.'],
        ['Light', 'Drag the sun at the top right from dawn to night. Everything retunes with it.'],
        ['Look', 'Scroll or pinch to zoom, drag with two fingers / right or middle mouse to move. Zoom far out to open the atlas.'],
        ['Keys', 'Esc puts a tool back · M mutes · 0 shows the whole valley · H opens this note.'],
      ],
      atlasTitle: 'Atlas of Valleys',
      newValley: 'New valley',
      open: 'Open',
      share: 'Share link',
      copied: 'Link copied',
      copyFail: 'Copy this link:',
      del: 'Delete',
      confirmDel: 'Sure? Delete',
      back: 'Back to the valley',
      rename: 'Click the name to rename',
      imported: 'A shared valley joined your atlas',
      saveFull: 'Your browser storage is full; this valley could not be saved.',
      credits: 'Sounds: Versilian Community Sample Library (CC0). Made with Claude.',
      muted: 'Muted', unmuted: 'Sound on',
      close: 'Close', lang: 'Türkçe',
      beats: (n) => n + (n === 1 ? ' beat' : ' beats'),
      names: [['Willow', 'Heron', 'Moss', 'Amber', 'Silver', 'Quiet', 'Lantern', 'Fern', 'Cedar', 'Misty', 'Copper', 'Poplar', 'Otter', 'Clover'],
        ['Bend', 'Pools', 'Hollow', 'Fork', 'Meadow', 'Falls', 'Reach', 'Glen', 'Basin', 'Run', 'Shallows', 'Ford']],
      demoName: 'First Light Valley',
    },
    tr: {
      title: 'Riversong',
      listen: 'Dinlemek için vadiye dokun',
      loading: 'Taşlar toplanıyor…',
      noWebgl: 'Riversong için WebGL 2 destekleyen bir tarayıcı gerekiyor (güncel Chrome, Edge, Firefox ya da Safari).',
      tools: { stone: 'Taş', reed: 'Kamış', twig: 'Dal', lantern: 'Fener', atlas: 'Atlas', help: 'Nasıl çalışır' },
      toolTips: {
        stone: 'Suya dokun: çakıl; basılı tut: büyür. Su boyunca sürükle: çakıl yatağı; suyun karşısına sürükle: şelale.',
        reed: 'Kıyı boyunca boya. Önce basılı tutarsan kamış uzar.',
        twig: 'Derenin karşısına koy, set olsun.',
        lantern: 'Suya bırak. İki fener bir kanon söyler.',
        atlas: 'Vadilerin',
        help: 'Nasıl çalışır',
      },
      times: ['Şafak', 'Sabah', 'Altın saat', 'Alacakaranlık', 'Gece'],
      hints: {
        draw: 'Su çizmek için toprağın üzerinde sürükle',
        pond: 'Üzerinde bir fener süzülüyor. Dereyi kendine geri bağla, gölet olsun',
        stone: 'Tepsiden bir taş al. Suya dokun: çakıl; basılı tut: büyür',
        more: 'Kamışlar uzun ses verir. Suyu sıkıştır ya da Shift+tekerlek: hızı değişir',
        twig: 'Derenin karşısına bir dal koy. Kaldırınca fenerler birlikte akar',
        light: 'Günü çevirmek için ışığı sürükle',
        zoom: 'Atlasını bulmak için sonuna kadar uzaklaş',
        lift: 'Dalı kaldırmak için ona dokun',
      },
      help: [
        ['Su çiz', 'Toprağın üzerinde sürükle. Her derede bir fener baştan sona, tekrar tekrar süzülür.'],
        ['Gölet', 'Bir dereyi kendine geri bağla. Küçük gölet çabuk tekrarlar, büyük göl yavaş açılır.'],
        ['Çatal', 'Bir derenin üzerinden çizmeye başla, kol ayrılsın. Fenerler sırayla sağa sola gider.'],
        ['Silmek', 'Suyun üzerinde ileri geri ov (ya da sağ tıkla sürükle); toprak üstünü kapatır.'],
        ['Taşlar', 'Suya dokun: çakıl; basılı tut: büyür. Büyük taş daha pes söyler. Su boyunca sürükle: çakıl yatağı; karşısına sürükle: şelale davulu.'],
        ['Kamışlar', 'Kıyı boyunca boya: boyadığın uzunlukta uzun bir ses. Önce basılı tutarsan daha uzun, daha pes kamış.'],
        ['Hız', 'Suyu sıkıştır: iki kat hızlı akar; genişlet: yarı hızda süzülür. Fareyle: suyun üstünde Shift+tekerlek.'],
        ['Fenerler', 'İkinci bir fener bırak: ezgi kendini kovalar. Feneri toprağa sürükle: söner.'],
        ['Set', 'Derenin karşısına bir dal koy: fenerler arkasında birikir. Dala dokunup kaldır: hep birlikte akarlar.'],
        ['Yağmur', 'Açık toprağa basılı tut. Her damla düştüğü taşı çalar.'],
        ['Işık', 'Sağ üstteki güneşi şafaktan geceye sürükle. Her şey onunla yeniden akort olur.'],
        ['Bakış', 'Yakınlaşmak için tekerlek ya da iki parmak; kaydırmak için iki parmak ya da sağ/orta tuş. Çok uzaklaşınca atlas açılır.'],
        ['Tuşlar', 'Esc aracı bırakır · M sesi kapatır · 0 bütün vadiyi gösterir · H bu notu açar.'],
      ],
      atlasTitle: 'Vadiler Atlası',
      newValley: 'Yeni vadi',
      open: 'Aç',
      share: 'Bağlantı paylaş',
      copied: 'Bağlantı kopyalandı',
      copyFail: 'Bu bağlantıyı kopyala:',
      del: 'Sil',
      confirmDel: 'Emin misin? Sil',
      back: 'Vadiye dön',
      rename: 'Adını değiştirmek için ada tıkla',
      imported: 'Paylaşılan bir vadi atlasına eklendi',
      saveFull: 'Tarayıcı depolaması dolu; bu vadi kaydedilemedi.',
      credits: 'Sesler: Versilian Community Sample Library (CC0). Claude ile yapıldı.',
      muted: 'Ses kapalı', unmuted: 'Ses açık',
      close: 'Kapat', lang: 'English',
      beats: (n) => n + ' vuruş',
      names: [['Söğüt', 'Balıkçıl', 'Yosun', 'Kehribar', 'Gümüş', 'Sessiz', 'Fener', 'Eğrelti', 'Sedir', 'Sisli', 'Bakır', 'Kavak', 'Su Samuru', 'Yonca'],
        ['Kıvrımı', 'Gölleri', 'Çukuru', 'Çatalı', 'Çayırı', 'Çağlayanı', 'Kıyısı', 'Vadisi', 'Havzası', 'Deresi', 'Sığlığı', 'Geçidi']],
      demoName: 'İlk Işık Vadisi',
    },
  };
  let lang = 'en';
  try {
    const saved = localStorage.getItem('riversong.lang');
    if (saved === 'en' || saved === 'tr') lang = saved;
    else if ((navigator.language || '').toLowerCase().startsWith('tr')) lang = 'tr';
  } catch (e) {
    if ((navigator.language || '').toLowerCase().startsWith('tr')) lang = 'tr';
  }
  const listeners = [];
  return {
    get lang() { return lang; },
    t() { return STR[lang]; },
    set(l) {
      if (l !== 'en' && l !== 'tr') return;
      lang = l;
      try { localStorage.setItem('riversong.lang', l); } catch (e) { /* storage may be blocked */ }
      document.documentElement.lang = l;
      listeners.forEach((f) => f(l));
    },
    toggle() { this.set(lang === 'en' ? 'tr' : 'en'); },
    onChange(f) { listeners.push(f); },
    randomName(r = Math.random) {
      const n = STR[lang].names;
      return n[0][Math.floor(r() * n[0].length)] + ' ' + n[1][Math.floor(r() * n[1].length)];
    },
  };
})();
