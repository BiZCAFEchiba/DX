window.CORNER_CONTENT = {
  worries: {
    title: 'スタッフがお悩み答えます!',
    note: 'カテゴリごとに、よくある相談とスタッフからのひとことをまとめています。',
    categories: [
      {
        id: 'worry-job-hunt',
        key: 'job-hunt',
        title: '就活関連',
        accent: 'career',
        published: true,
        sortOrder: 10,
        entries: [
          {
            id: 'worry-job-hunt-1',
            question: '自己分析は何から始めるのがいいですか？',
            answer: 'まずは、これまで楽しかった経験や頑張れた場面を書き出してみるのがおすすめです。',
            published: true,
            sortOrder: 10
          },
          {
            id: 'worry-job-hunt-2',
            question: 'インターンに参加していなくても大丈夫ですか？',
            answer: '大丈夫です。参加有無より、そこから何を学び、どう動いたかを言葉にできることが大切です。',
            published: true,
            sortOrder: 20
          }
        ]
      },
      {
        id: 'worry-class',
        key: 'class',
        title: '単位・授業関連',
        accent: 'study',
        published: true,
        sortOrder: 20,
        entries: [
          {
            id: 'worry-class-1',
            question: '授業と就活の両立が不安です。',
            answer: '予定が見える化できるとかなり楽になります。先に固定予定を書き出して、空き時間で動く形にすると整理しやすいです。',
            published: true,
            sortOrder: 10
          }
        ]
      },
      {
        id: 'worry-other',
        key: 'other',
        title: 'その他なんでも!',
        accent: 'other',
        published: true,
        sortOrder: 30,
        entries: [
          {
            id: 'worry-other-1',
            question: 'BizCAFEはどう使うのがおすすめですか？',
            answer: '空きコマの作業、イベント参加、スタッフとの雑談など、その日の気分で使い分けてもらって大丈夫です。',
            published: true,
            sortOrder: 10
          }
        ]
      }
    ]
  },
  participation: {
    title: '参加型コーナー',
    prompt: 'みんなの出身地は？',
    note: '初期版では地域タグでゆるく表現しています。',
    stickyNote: '気になる地域があったらスタッフにも聞いてみてください。',
    tags: [
      { id: 'region-hokkaido', label: '北海道', count: '1名', tone: 'blue', published: true, sortOrder: 10 },
      { id: 'region-tohoku', label: '東北', count: '2名', tone: 'teal', published: true, sortOrder: 20 },
      { id: 'region-kanto', label: '関東', count: '6名', tone: 'yellow', published: true, sortOrder: 30 },
      { id: 'region-chubu', label: '中部', count: '3名', tone: 'pink', published: true, sortOrder: 40 },
      { id: 'region-kansai', label: '関西', count: '2名', tone: 'green', published: true, sortOrder: 50 },
      { id: 'region-kyushu', label: '九州', count: '1名', tone: 'orange', published: true, sortOrder: 60 }
    ]
  },
  industryQa: {
    title: '業界・企業Q&Aコーナー',
    note: '気になる業界タグを押すと、そのテーマのQ&Aだけを見られます。',
    tags: [
      { id: 'it', label: 'IT', sortOrder: 10, published: true },
      { id: 'maker', label: 'メーカー', sortOrder: 20, published: true },
      { id: 'consulting', label: 'コンサル', sortOrder: 30, published: true },
      { id: 'trading', label: '商社', sortOrder: 40, published: true }
    ],
    items: [
      {
        id: 'industry-it-1',
        title: 'IT業界は文系でも挑戦できますか？',
        comment: '基礎から学びたい人向け',
        body: '文系から挑戦している先輩も多いです。業界理解に加えて、なぜITに興味を持ったのかを整理しておくと話しやすくなります。',
        tagId: 'it',
        published: true,
        sortOrder: 10
      },
      {
        id: 'industry-maker-1',
        title: 'メーカーは職種の幅が広いと聞きました。',
        comment: '職種理解の入口',
        body: '研究、技術、営業、企画など幅が広いです。まずは職種ごとに働き方がどう違うかを見ると理解しやすいです。',
        tagId: 'maker',
        published: true,
        sortOrder: 20
      },
      {
        id: 'industry-consulting-1',
        title: 'コンサル業界って何をしているの？',
        comment: '業界の基本',
        body: '課題整理や改善提案を通じて企業を支援する仕事です。まずは「誰のどんな課題を扱うか」で会社ごとの差を見るのがおすすめです。',
        tagId: 'consulting',
        published: true,
        sortOrder: 30
      },
      {
        id: 'industry-trading-1',
        title: '商社とメーカーの違いが分かりません。',
        comment: '比較のヒント',
        body: '商社はモノや事業をつなぐ立場、メーカーは自社でつくる立場という違いから見ると整理しやすいです。',
        tagId: 'trading',
        published: true,
        sortOrder: 40
      }
    ]
  },
  staffColumns: {
    title: 'スタッフ紹介・コラム',
    staff: [
      {
        id: 'staff-1',
        name: 'Aoi',
        role: '3年 / 就活伴走スタッフ',
        profile: '就活の進め方や、最初の一歩の踏み出し方を一緒に整理するのが得意です。',
        tags: ['就活', '自己分析'],
        published: true,
        sortOrder: 10
      },
      {
        id: 'staff-2',
        name: 'Riku',
        role: '4年 / 業界研究サポート',
        profile: '業界比較や企業研究の始め方を、分かりやすく伝えることを大切にしています。',
        tags: ['業界研究', '企業比較'],
        published: true,
        sortOrder: 20
      }
    ],
    columns: [
      {
        id: 'column-1',
        title: 'BizCAFEスタッフが考える、就活の最初の一歩',
        body: 'まずは完璧に進めようとせず、気になる業界を3つほど挙げてみるだけでも十分です。少しずつ輪郭を作っていきましょう。',
        published: true,
        sortOrder: 10
      },
      {
        id: 'column-2',
        title: '授業が忙しい時期の就活との向き合い方',
        body: '全部を同時に頑張るより、今週やることを絞る方が続きやすいです。スタッフにも気軽に相談してください。',
        published: true,
        sortOrder: 20
      }
    ]
  }
};
