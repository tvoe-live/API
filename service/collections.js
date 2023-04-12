const repository = require("../repository/collections");

class CollectionService {
    static async getCollections(){
        const result = await repository.getCollections();

        const collections = [
            ...result[0]['collections'],
            ...result[0]['genres']
        ]

        return collections
            .filter(collection => collection.items.length >= 12)
            .map(collection => ({
                ...collection,
                items: collection.items.slice(0, 24)
            }));
    }
}

module.exports = CollectionService;