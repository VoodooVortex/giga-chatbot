-- ============================================================================
-- Create RAG Triggers on Business Tables (Updated for Orbis-Track Schema)
-- ============================================================================

-- Note: These triggers assume the tables exist in the public schema
-- They should be run after the main app has created its tables

-- Devices table triggers
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables 
               WHERE table_schema = 'public' AND table_name = 'devices') THEN
        
        -- Drop existing triggers if they exist
        DROP TRIGGER IF EXISTS rag_update_devices ON public.devices;
        DROP TRIGGER IF EXISTS rag_update_devices_delete ON public.devices;
        
        -- INSERT/UPDATE trigger
        CREATE TRIGGER rag_update_devices
            AFTER INSERT OR UPDATE ON public.devices
            FOR EACH ROW
            EXECUTE FUNCTION public.notify_rag_update();
            
        -- DELETE trigger
        CREATE TRIGGER rag_update_devices_delete
            AFTER DELETE ON public.devices
            FOR EACH ROW
            EXECUTE FUNCTION public.notify_rag_update_delete();
            
        RAISE NOTICE 'Created RAG triggers for devices table';
    END IF;
END $$;

-- Device childs table triggers
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables 
               WHERE table_schema = 'public' AND table_name = 'device_childs') THEN
        
        DROP TRIGGER IF EXISTS rag_update_device_childs ON public.device_childs;
        DROP TRIGGER IF EXISTS rag_update_device_childs_delete ON public.device_childs;
        
        CREATE TRIGGER rag_update_device_childs
            AFTER INSERT OR UPDATE ON public.device_childs
            FOR EACH ROW
            EXECUTE FUNCTION public.notify_rag_update();
            
        CREATE TRIGGER rag_update_device_childs_delete
            AFTER DELETE ON public.device_childs
            FOR EACH ROW
            EXECUTE FUNCTION public.notify_rag_update_delete();
            
        RAISE NOTICE 'Created RAG triggers for device_childs table';
    END IF;
END $$;

-- Categories table triggers
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables 
               WHERE table_schema = 'public' AND table_name = 'categories') THEN
        
        DROP TRIGGER IF EXISTS rag_update_categories ON public.categories;
        DROP TRIGGER IF EXISTS rag_update_categories_delete ON public.categories;
        
        CREATE TRIGGER rag_update_categories
            AFTER INSERT OR UPDATE ON public.categories
            FOR EACH ROW
            EXECUTE FUNCTION public.notify_rag_update();
            
        CREATE TRIGGER rag_update_categories_delete
            AFTER DELETE ON public.categories
            FOR EACH ROW
            EXECUTE FUNCTION public.notify_rag_update_delete();
            
        RAISE NOTICE 'Created RAG triggers for categories table';
    END IF;
END $$;

-- Borrow return tickets table triggers
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables 
               WHERE table_schema = 'public' AND table_name = 'borrow_return_tickets') THEN
        
        DROP TRIGGER IF EXISTS rag_update_borrow_return_tickets ON public.borrow_return_tickets;
        DROP TRIGGER IF EXISTS rag_update_borrow_return_tickets_delete ON public.borrow_return_tickets;
        
        CREATE TRIGGER rag_update_borrow_return_tickets
            AFTER INSERT OR UPDATE ON public.borrow_return_tickets
            FOR EACH ROW
            EXECUTE FUNCTION public.notify_rag_update();
            
        CREATE TRIGGER rag_update_borrow_return_tickets_delete
            AFTER DELETE ON public.borrow_return_tickets
            FOR EACH ROW
            EXECUTE FUNCTION public.notify_rag_update_delete();
            
        RAISE NOTICE 'Created RAG triggers for borrow_return_tickets table';
    END IF;
END $$;

-- Ticket issues table triggers
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables 
               WHERE table_schema = 'public' AND table_name = 'ticket_issues') THEN
        
        DROP TRIGGER IF EXISTS rag_update_ticket_issues ON public.ticket_issues;
        DROP TRIGGER IF EXISTS rag_update_ticket_issues_delete ON public.ticket_issues;
        
        CREATE TRIGGER rag_update_ticket_issues
            AFTER INSERT OR UPDATE ON public.ticket_issues
            FOR EACH ROW
            EXECUTE FUNCTION public.notify_rag_update();
            
        CREATE TRIGGER rag_update_ticket_issues_delete
            AFTER DELETE ON public.ticket_issues
            FOR EACH ROW
            EXECUTE FUNCTION public.notify_rag_update_delete();
            
        RAISE NOTICE 'Created RAG triggers for ticket_issues table';
    END IF;
END $$;