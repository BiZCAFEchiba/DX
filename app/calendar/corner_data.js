window.CORNER_CONTENT = {
  questionCategories: [
    { id: 'job-hunt', label: '就活関連', sortOrder: 10, published: true },
    { id: 'class', label: '単位・授業関連', sortOrder: 20, published: true },
    { id: 'other', label: 'その他', sortOrder: 30, published: true },
    { id: 'industry', label: '業界・企業関連', sortOrder: 40, published: true }
  ],
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
            question: '自己分析はどこから始めるのがよいですか?',
            answer: 'まずは、これまで楽しかったことや頑張れた経験を3つほど書き出してみるのがおすすめです。',
            published: true,
            sortOrder: 10
          },
          {
            id: 'worry-job-hunt-2',
            question: 'インターンに参加していなくても大丈夫ですか?',
            answer: '大丈夫です。参加の有無よりも、そこから何を学びどう動いたかが大切です。',
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
            answer: '先に締切のある予定を見える化して、週ごとにやることを分けると整理しやすいです。',
            published: true,
            sortOrder: 10
          }
        ]
      },
      {
        id: 'worry-other',
        key: 'other',
        title: 'その他何でも!!',
        accent: 'other',
        published: true,
        sortOrder: 30,
        entries: [
          {
            id: 'worry-other-1',
            question: 'BizCAFEはどんなときに使うのがおすすめですか?',
            answer: '相談したいとき、予定の合間に休憩したいとき、スタッフと気軽に話したいときに使ってもらえます。',
            published: true,
            sortOrder: 10
          }
        ]
      }
    ]
  },
  participation: {
    title: '参加型コーナー',
    prompt: 'みんなの声をちょっとずつ集めるコーナーです。',
    note: '公開中テーマをひとつ選んで投票できます。',
    stickyNote: '気軽に選んでみてください!',
    themes: [
      {
        id: 'theme-origin',
        title: 'みんなの出身地',
        description: '出身地に近い地域を選んでください。',
        published: true,
        sortOrder: 10,
        options: [
          { id: 'hokkaido', label: '北海道', votes: 1, sortOrder: 10, published: true },
          { id: 'tohoku', label: '東北', votes: 2, sortOrder: 20, published: true },
          { id: 'kanto', label: '関東', votes: 6, sortOrder: 30, published: true },
          { id: 'chubu', label: '中部', votes: 3, sortOrder: 40, published: true },
          { id: 'kansai', label: '関西', votes: 2, sortOrder: 50, published: true },
          { id: 'kyushu', label: '九州', votes: 1, sortOrder: 60, published: true }
        ]
      }
    ]
  },
  staffColumns: {
    title: 'スタッフ紹介・コラム',
    staff: [
      {
        id: 'staff-1',
        name: 'Aoi',
        role: '3年 / 就活相談スタッフ',
        profile: '就活の進め方や自己分析の相談を担当。まずは雑談からでも大丈夫です。',
        tags: ['就活', '自己分析'],
        published: true,
        sortOrder: 10
      },
      {
        id: 'staff-2',
        name: 'Riku',
        role: '4年 / 業界研究サポート',
        profile: '業界研究や企業比較の始め方を一緒に整理します。',
        tags: ['業界研究', '企業比較'],
        published: true,
        sortOrder: 20
      }
    ],
    columns: [
      {
        id: 'column-1',
        title: 'BizCAFEスタッフが考える、就活の最初の一歩',
        body: 'まずは興味のあることを3つ書き出してみるだけでも前に進めます。',
        published: true,
        sortOrder: 10
      }
    ]
  }
};
