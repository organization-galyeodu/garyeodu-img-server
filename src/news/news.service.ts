import { Injectable } from '@nestjs/common';
import * as Parser from 'rss-parser';

@Injectable()
export class NewsService {
  private parser = new Parser();
  private readonly rssUrl =
    'https://news.google.com/rss/search?q=사진%20개인정보%20유출&hl=ko&gl=KR&ceid=KR:ko';

  async getNews() {
    try {
      const feed = await this.parser.parseURL(encodeURI(this.rssUrl));
      return feed.items;
    } catch (error) {
      console.error('Error fetching or parsing RSS feed:', error);
      throw new Error('Could not fetch news.');
    }
  }
}
